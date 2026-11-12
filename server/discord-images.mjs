import { imageType } from './images.mjs';

// Inbound CDN fetches are deliberately separate from authenticated Discord REST.
export const DISCORD_IMAGE_LIMITS = Object.freeze({ count: 4, bytes: 20 * 1024 * 1024, aggregate: 20 * 1024 * 1024 });
const TYPES = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/gif', 'gif'], ['image/webp', 'webp']]);
const failure = code => new Error(`discord_image_${code}`);
function cdnUrl(value) {
  try {
    if (typeof value !== 'string' || value.length > 4096 || /[\\\s\u0000-\u001f]/.test(value) || !/^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(value)) throw new Error();
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) || url.port || url.username || url.password || url.hash) throw new Error();
    // Check the original path too: URL parsing must not normalize traversal away.
    const path = value.slice(value.indexOf('/', 8)).split('?')[0];
    const parts = path.split('/');
    if (parts.length !== 5 || parts[1] !== 'attachments' || !/^\d{1,32}$/.test(parts[2]) || !/^\d{1,32}$/.test(parts[3])) throw new Error();
    const filename = decodeURIComponent(parts[4]);
    if (!filename || filename === '.' || filename === '..' || /[/\\\u0000-\u001f\u007f]/.test(filename)) throw new Error();
    return url.href;
  } catch { throw failure('download_failed'); }
}
function declaredType(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw failure('unsupported');
  const type = value.split(';')[0].trim().toLowerCase();
  if (!TYPES.has(type)) throw failure('unsupported');
  return type;
}
async function readBytes(response, signal, limit) {
  if (!response.ok || response.status !== 200 || response.redirected || !response.body?.getReader) {
    void response.body?.cancel?.().catch(() => {}); throw failure('download_failed');
  }
  const length = response.headers?.get?.('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > limit) {
    void response.body.cancel().catch(() => {}); throw failure('too_large');
  }
  const reader = response.body.getReader(), parts = [];
  let size = 0, complete = false;
  const aborted = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', aborted, { once: true });
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) { complete = true; break; }
      if (!(value instanceof Uint8Array)) throw failure('download_failed');
      size += value.byteLength;
      if (size > limit) throw failure('too_large');
      parts.push(Buffer.from(value));
    }
    return Buffer.concat(parts, size);
  } finally {
    signal.removeEventListener('abort', aborted);
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Download every attachment or reject the whole message; never forward a partial caption. */
export async function downloadDiscordImages(attachments, { fetchImpl = fetch, signal } = {}) {
  try {
    if (!Array.isArray(attachments) || !attachments.length) return [];
    if (attachments.length > DISCORD_IMAGE_LIMITS.count) throw failure('too_many');
    let declaredBytes = 0;
    // Validate all metadata before any network request.
    const candidates = attachments.map(item => {
      if (!item || typeof item !== 'object') throw failure('download_failed');
      const url = cdnUrl(item.url), type = declaredType(item.content_type);
      if (item.size !== undefined && (!Number.isSafeInteger(item.size) || item.size < 0)) throw failure('download_failed');
      declaredBytes += item.size || 0;
      if (item.size > DISCORD_IMAGE_LIMITS.bytes || declaredBytes > DISCORD_IMAGE_LIMITS.aggregate) throw failure('too_large');
      return { url, type };
    });
    const requestSignal = AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
    const result = []; let total = 0;
    for (const [index, candidate] of candidates.entries()) {
      requestSignal.throwIfAborted();
      const response = await fetchImpl(candidate.url, { method: 'GET', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', signal: requestSignal });
      if (response.url && response.url !== candidate.url) { void response.body?.cancel?.().catch(() => {}); throw failure('download_failed'); }
      const bytes = await readBytes(response, requestSignal, Math.min(DISCORD_IMAGE_LIMITS.bytes, DISCORD_IMAGE_LIMITS.aggregate - total));
      const type = imageType(bytes), header = response.headers?.get?.('content-type');
      if (!type || (candidate.type && candidate.type !== type) || (header && declaredType(header) !== type)) throw failure('unsupported');
      total += bytes.length;
      result.push({ name: `discord-image-${index + 1}.${TYPES.get(type)}`, type, size: bytes.length, encoding: 'data-url', content: `data:${type};base64,${bytes.toString('base64')}` });
    }
    return result;
  } catch (error) {
    if (/^discord_image_(download_failed|too_large|too_many|unsupported)$/.test(error?.message)) throw error;
    throw failure('download_failed');
  }
}
