// Transport delivery uses receipt-owned bytes, never Core preview URLs.
export const OUTPUT_IMAGE_LIMITS = Object.freeze({ count: 10, bytes: 10 * 1024 * 1024, aggregate: 20 * 1024 * 1024 });
export function imageType(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
const types = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const failure = code => new Error(`output_attachment_${code}`);
export function outputAttachmentError(error) {
  return /^output_attachment_(unavailable|unsupported|too_large|too_many|invalid)$/.test(error?.message) ? error.message : 'output_attachment_unavailable';
}
export function validateOutputImage(image) {
  if (!image || !Buffer.isBuffer(image.bytes) || !image.bytes.length || typeof image.name !== 'string' || !image.name || image.name.length > 255 || /[/\\\u0000-\u001f\u007f]/.test(image.name)) throw failure('invalid');
  if (image.bytes.length > OUTPUT_IMAGE_LIMITS.bytes) throw failure('too_large');
  if (!types.has(image.mimeType) || imageType(image.bytes) !== image.mimeType) throw failure('unsupported');
  return image;
}
/** Preflight the complete result before any transport send. No partial artifact omission. */
export async function readOutputImages(turns, turn, signal) {
  const descriptors = turn.result?.attachments ?? [];
  if (!Array.isArray(descriptors)) throw failure('invalid');
  if (!descriptors.length) return [];
  if (descriptors.length > OUTPUT_IMAGE_LIMITS.count) throw failure('too_many');
  if (typeof turns?.readAttachment !== 'function') throw failure('unavailable');
  let total = 0;
  const ids = new Set();
  for (const item of descriptors) {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.name !== 'string' || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1) throw failure('invalid');
    ids.add(item.id);
    if (!types.has(item.mimeType)) throw failure('unsupported');
    total += item.sizeBytes;
    if (item.sizeBytes > OUTPUT_IMAGE_LIMITS.bytes || total > OUTPUT_IMAGE_LIMITS.aggregate) throw failure('too_large');
  }
  const result = [];
  const readSignal = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  for (const item of descriptors) {
    readSignal.throwIfAborted();
    // The capability has no cancellation parameter. Bound our waiter as well as
    // descriptor/base64 allocation; a late capability result cannot trigger a send.
    let abortListener;
    const aborted = new Promise((_, reject) => {
      abortListener = () => reject(failure('unavailable'));
      readSignal.addEventListener('abort', abortListener, { once: true });
    });
    let value;
    try { value = await Promise.race([Promise.resolve().then(() => turns.readAttachment(turn.id, item.id)), aborted]); }
    catch { throw failure('unavailable'); }
    finally { readSignal.removeEventListener('abort', abortListener); }
    readSignal.throwIfAborted();
    // Avoid repeated-group regex recursion on multi-MiB base64. Exact length
    // and the canonical encode/decode roundtrip below enforce padding and bits.
    if (!value || value.encoding !== 'base64' || value.name !== item.name || value.mimeType !== item.mimeType || value.sizeBytes !== item.sizeBytes || typeof value.content !== 'string' || value.content.length !== 4 * Math.ceil(item.sizeBytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.content)) throw failure('invalid');
    const bytes = Buffer.from(value.content, 'base64');
    if (bytes.length !== item.sizeBytes || bytes.toString('base64') !== value.content) throw failure('invalid');
    result.push(validateOutputImage({ name: item.name, mimeType: item.mimeType, bytes }));
  }
  return result;
}
