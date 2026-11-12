import test from 'node:test';
import { ANIMATED_GIF } from './fixtures/animated-gif.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { imageType, validateOutputImage, readOutputImages, outputAttachmentError, OUTPUT_IMAGE_LIMITS } from '../server/images.mjs';
import { createTelegramApi, createTelegramConnection } from '../server/telegram.mjs';
import { createDiscordApi, createDiscordConnection } from '../server/discord.mjs';
import { createSwitchboardService } from '../server/connections.mjs';

// Actual image payloads (including binary NUL/high bytes), never preview URLs.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
const GIF = ANIMATED_GIF;
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const IMAGES = [
  { name: 'render.png', mimeType: 'image/png', bytes: PNG },
  { name: 'animation.gif', mimeType: 'image/gif', bytes: GIF },
  { name: 'sticker.webp', mimeType: 'image/webp', bytes: WEBP },
];
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const telegramRoute = (chatId, topicId = null) => hash(`telegram:${chatId}:${topicId ?? 'root'}`);
const descriptor = (image = IMAGES[0], id = 'artifact-0') => ({ id, name: image.name, mimeType: image.mimeType, sizeBytes: image.bytes.length });
const encoded = (image = IMAGES[0]) => ({ name: image.name, mimeType: image.mimeType, sizeBytes: image.bytes.length, encoding: 'base64', content: image.bytes.toString('base64') });
const receipt = (attachments = IMAGES.map((image, i) => descriptor(image, `artifact-${i}`)), answerText = '') => ({ id: 'turn-output', status: 'succeeded', result: { answerText, attachments } });
const json = (kind, value, status = 200) => new Response(JSON.stringify(kind === 'telegram' ? { ok: true, result: value } : value), { status, headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function store() {
  const data = new Map();
  return { data, get: async (key, fallback = null) => structuredClone(data.has(key) ? data.get(key) : fallback), set: async (key, value) => data.set(key, structuredClone(value)), delete: async key => data.delete(key) };
}

// Force the FormData through actual multipart serialization and parsing: checking
// just Blob objects would miss broken wire bytes, boundaries or attachment names.
async function wireRequest(url, init) {
  const request = new Request(url, init);
  const raw = Buffer.from(await request.arrayBuffer());
  const contentType = request.headers.get('content-type');
  const form = init.body instanceof FormData ? await new Response(raw, { headers: { 'content-type': contentType } }).formData() : null;
  return { url, init, raw, contentType, form, payload: form?.has('payload_json') ? JSON.parse(form.get('payload_json')) : form ? null : JSON.parse(raw.toString()) };
}
async function assertFile(file, image) {
  assert.equal(file.name, image.name);
  assert.equal(file.type, image.mimeType);
  assert.equal(file.size, image.bytes.length);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), image.bytes);
}

function fixture(kind, { turn = receipt(), readAttachment, missingCapability = false, sendFailure = 0, connectionId = 'outbound', topicId = 77 } = {}) {
  const settings = store(), reads = [], calls = [], events = [];
  const route = kind === 'telegram'
    ? { id: telegramRoute('-100'), chatId: '-100', topicId: null, chatType: 'supergroup', chatTitle: 'Council', agentId: 'agent', enabled: true }
    : { id: 'discord-route', chatId: '400', channelId: '400', guildId: '500', chatType: 'thread', chatTitle: 'Thread', agentId: 'agent', enabled: true, inherited: false };
  const inbound = { id: 'in:1000', direction: 'inbound', status: 'processing', turnId: turn.id, agentId: 'agent', chatId: route.chatId, chatType: route.chatType, chatTitle: route.chatTitle,
    ...(kind === 'telegram' ? { topicId, telegramMessageId: 1000 } : { channelId: '400', guildId: '500', messageId: '1000' }) };
  settings.data.set('configuration', { enabled: true, agentId: 'agent' });
  settings.data.set('transport-state', { bot: { id: '100', username: 'output_bot', bot: true } });
  settings.data.set('mappings', [route]); settings.data.set('deliveries', [inbound]);
  const context = { settings, secrets: { get: async () => '123:SECRET', has: async () => true, set: async () => {}, clear: async () => {} }, agents: {
    list: async () => [{ id: 'agent', enabled: true }, { id: 'other', enabled: true }], turns: {
      submit: async () => assert.fail('outbound reconciliation must never submit another turn'),
      read: async id => { assert.equal(id, turn.id); return turn; },
      ...(!missingCapability ? { readAttachment: async (turnId, attachmentId) => {
        assert.equal(turnId, turn.id); reads.push([turnId, attachmentId]); events.push(`read:${attachmentId}`);
        return readAttachment ? readAttachment(turnId, attachmentId) : encoded(IMAGES[Number(attachmentId.split('-').at(-1))]);
      } } : {}),
    },
  }, logger: { error() {} } };
  const fetchImpl = async (url, init) => {
    assert.equal(settings.data.get('deliveries').find(item => item.id === `out:${turn.id}`)?.status, 'sending', 'write-ahead status must precede every transport send');
    const call = await wireRequest(url, init); calls.push(call); events.push('send');
    if (calls.length === sendFailure) throw new Error('SECRET response lost https://private.invalid');
    return json(kind, kind === 'telegram' ? { message_id: 2000 + calls.length, date: 1 } : { id: String(2000 + calls.length) });
  };
  const api = (kind === 'telegram' ? createTelegramApi : createDiscordApi)({ token: '123:SECRET', fetchImpl });
  const create = () => (kind === 'telegram' ? createTelegramConnection : createDiscordConnection)({ context, connectionId });
  const service = create();
  return { kind, service, create, settings, context, route, inbound, turn, reads, calls, events, api };
}
const ledgerItem = (f, direction) => f.settings.data.get('deliveries').find(item => item.direction === direction);

// Shared byte/preflight contract, independently of either transport.
test('output image MIME signatures and safe names are enforced, including JPEG and both GIF variants', () => {
  for (const image of [...IMAGES, { name: 'photo.jpg', mimeType: 'image/jpeg', bytes: JPEG }]) {
    assert.equal(imageType(image.bytes), image.mimeType); assert.equal(validateOutputImage(image), image);
  }
  assert.equal(imageType(Buffer.from('GIF87a')), 'image/gif');
  for (const bytes of [Buffer.alloc(0), PNG.subarray(0, 7), Buffer.from('RIFF1234NOTP'), Buffer.from('<svg/>')]) assert.equal(imageType(bytes), null);
  for (const name of ['', '../x.png', 'x/y.png', 'x\\y.png', 'nul\0.png', 'line\n.png', 'del\x7f.png', 'x'.repeat(256)]) assert.throws(() => validateOutputImage({ ...IMAGES[0], name }), /output_attachment_invalid/);
  assert.equal(validateOutputImage({ ...IMAGES[0], name: 'x'.repeat(255) }).name.length, 255);
  for (const bytes of [null, new Uint8Array(PNG), Buffer.alloc(0)]) assert.throws(() => validateOutputImage({ ...IMAGES[0], bytes }), /output_attachment_invalid/);
  assert.throws(() => validateOutputImage({ ...IMAGES[0], mimeType: 'image/gif' }), /output_attachment_unsupported/);
  assert.throws(() => validateOutputImage({ ...IMAGES[0], mimeType: 'image/svg+xml' }), /output_attachment_unsupported/);
  assert.throws(() => validateOutputImage({ ...IMAGES[0], bytes: Buffer.alloc(OUTPUT_IMAGE_LIMITS.bytes + 1) }), /output_attachment_too_large/);
  for (const code of ['unavailable', 'unsupported', 'too_large', 'too_many', 'invalid']) assert.equal(outputAttachmentError(new Error(`output_attachment_${code}`)), `output_attachment_${code}`);
  for (const error of [null, new Error('SECRET'), new Error('output_attachment_invalid: SECRET')]) assert.equal(outputAttachmentError(error), 'output_attachment_unavailable');
});

test('receipt reads preserve descriptor order and actual bytes, do not use preview URLs, and accept text-only old Core', async () => {
  assert.deepEqual(await readOutputImages({}, { id: 'old', result: { answerText: 'text' } }), []);
  assert.deepEqual(await readOutputImages({}, { id: 'old' }), []);
  const turn = receipt(); turn.result.attachments.forEach(item => { item.previewUrl = 'https://do-not-fetch.invalid/'; });
  const reads = [];
  const images = await readOutputImages({ readAttachment: async (...args) => { reads.push(args); return encoded(IMAGES[Number(args[1].split('-').at(-1))]); } }, turn);
  assert.deepEqual(images, IMAGES); assert.deepEqual(reads, IMAGES.map((_, i) => [turn.id, `artifact-${i}`]));
});

const preflightCases = [
  { name: 'missing read capability', missingCapability: true, error: 'unavailable', reads: 0 },
  { name: 'capability throws private details', readAttachment: () => { throw new Error('SECRET base64 https://private.invalid'); }, error: 'unavailable' },
  { name: 'capability returns null', value: null, error: 'invalid' },
  { name: 'not an attachment array', attachments: {}, error: 'invalid', reads: 0 },
  { name: 'count greater than ten', attachments: Array.from({ length: 11 }, (_, i) => descriptor(IMAGES[0], `id-${i}`)), error: 'too_many', reads: 0 },
  { name: 'duplicate descriptor IDs', attachments: [descriptor(), descriptor()], error: 'invalid', reads: 0 },
  ...[null, {}, { ...descriptor(), id: '' }, { ...descriptor(), id: 1 }, { ...descriptor(), name: null }, { ...descriptor(), sizeBytes: 0 }, { ...descriptor(), sizeBytes: -1 }, { ...descriptor(), sizeBytes: 1.5 }, { ...descriptor(), sizeBytes: Number.MAX_SAFE_INTEGER + 1 }].map((item, i) => ({ name: `invalid descriptor ${i}`, attachments: [item], error: 'invalid', reads: 0 })),
  { name: 'unsupported descriptor MIME', attachments: [{ ...descriptor(), mimeType: 'image/svg+xml' }], error: 'unsupported', reads: 0 },
  { name: 'single descriptor above byte limit', attachments: [{ ...descriptor(), sizeBytes: OUTPUT_IMAGE_LIMITS.bytes + 1 }], error: 'too_large', reads: 0 },
  { name: 'declared aggregate above limit', attachments: [0, 1, 2].map(i => ({ ...descriptor(IMAGES[0], `large-${i}`), sizeBytes: i < 2 ? OUTPUT_IMAGE_LIMITS.bytes : 1 })), error: 'too_large', reads: 0 },
  ...[
    ['wrong encoding', { encoding: 'data-url' }], ['name mismatch', { name: 'other.png' }], ['MIME mismatch', { mimeType: 'image/gif' }], ['size mismatch', { sizeBytes: PNG.length + 1 }],
    ['missing content', { content: null }], ['short content', { content: PNG.toString('base64').slice(4) }], ['long content', { content: `${PNG.toString('base64')}AAAA` }],
    ['invalid alphabet', { content: `!${PNG.toString('base64').slice(1)}` }], ['embedded whitespace', { content: `\n${PNG.toString('base64').slice(1)}` }],
    ['bad padding', { content: `${PNG.toString('base64').slice(0, -2)}=A` }],
  ].map(([name, patch]) => ({ name, value: { ...encoded(), ...patch }, error: 'invalid' })),
  { name: 'correct length but decoded bytes are not an image', value: { ...encoded(), content: Buffer.alloc(PNG.length).toString('base64') }, error: 'unsupported' },
  { name: 'safe metadata but MIME disagrees with magic', attachments: [{ ...descriptor(), mimeType: 'image/gif' }], value: { ...encoded(), mimeType: 'image/gif' }, error: 'unsupported' },
  { name: 'unsafe filename from receipt', attachments: [{ ...descriptor(), name: '../render.png' }], value: { ...encoded(), name: '../render.png' }, error: 'invalid' },
  // AB== decodes to the same single byte as AA==, but is not canonical base64.
  { name: 'noncanonical base64 pad bits', attachments: [{ ...descriptor(), sizeBytes: 1 }], value: { ...encoded(), sizeBytes: 1, content: 'AB==' }, error: 'invalid' },
];

for (const kind of ['telegram', 'discord']) {
  test(`${kind}: complete preflight failures are honest failed outcomes before any text sends`, async t => {
    for (const item of preflightCases) await t.test(item.name, async t => {
      const f = fixture(kind, { turn: receipt(item.attachments ?? [descriptor()], 'must not send partial text'), missingCapability: item.missingCapability,
        readAttachment: item.readAttachment ?? (() => Object.hasOwn(item, 'value') ? item.value : encoded()) });
      t.after(() => f.service.close());
      await f.service.reconcile(f.api);
      assert.equal(f.calls.length, 0);
      assert.equal(f.reads.length, item.reads ?? 1);
      for (const direction of ['inbound', 'outbound']) {
        assert.equal(ledgerItem(f, direction).status, 'failed');
        assert.equal(ledgerItem(f, direction).error, `output_attachment_${item.error}`);
      }
      const previousReads = f.reads.length;
      await f.service.reconcile(f.api);
      assert.equal(f.calls.length, 0); assert.equal(f.reads.length, previousReads, 'terminal preflight failure is not automatically retried');
      assert.doesNotMatch(JSON.stringify(await f.service.publicState()), /SECRET|private\.invalid|must not send|iVBOR|base64|previewUrl/);
    });
  });

  test(`${kind}: a later invalid artifact prevents text and earlier valid images from being partially delivered`, async t => {
    const f = fixture(kind, { turn: receipt(undefined, 'do not send'), readAttachment: (_id, artifactId) => artifactId === 'artifact-1' ? null : encoded(IMAGES[0]) });
    t.after(() => f.service.close()); await f.service.reconcile(f.api);
    assert.equal(f.reads.length, 2); assert.equal(f.calls.length, 0);
    assert.equal(ledgerItem(f, 'outbound').status, 'failed');
  });

  test(`${kind}: image-only result delivers binary PNG/GIF/WebP without inventing text`, async t => {
    const f = fixture(kind); t.after(() => f.service.close()); await f.service.reconcile(f.api);
    assert.deepEqual(f.events.slice(0, 3), ['read:artifact-0', 'read:artifact-1', 'read:artifact-2']);
    if (kind === 'telegram') {
      assert.equal(f.calls.length, 3);
      for (const [i, call] of f.calls.entries()) {
        assert.equal(call.url, `https://api.telegram.org/bot123:SECRET/${['sendPhoto', 'sendAnimation', 'sendDocument'][i]}`);
        assert.equal(call.form.get('chat_id'), '-100'); assert.equal(call.form.get('message_thread_id'), '77');
        assert.equal(call.form.get('text'), null); assert.equal(call.form.get('caption'), null);
        assert.deepEqual(call.form.get('reply_parameters') ? JSON.parse(call.form.get('reply_parameters')) : null, i === 0 ? { message_id: 1000, allow_sending_without_reply: true } : null);
        assert.deepEqual([...call.form.keys()].sort(), ['chat_id', 'message_thread_id', ['photo', 'animation', 'document'][i], ...(i === 0 ? ['reply_parameters'] : [])].sort());
        await assertFile(call.form.get(['photo', 'animation', 'document'][i]), IMAGES[i]);
      }
    } else {
      assert.equal(f.calls.length, 1); const call = f.calls[0];
      assert.equal(call.url, 'https://discord.com/api/v10/channels/400/messages');
      assert.equal(call.payload.content, undefined);
      assert.deepEqual(call.payload.attachments, IMAGES.map((image, id) => ({ id, filename: image.name })));
      assert.deepEqual(call.payload.allowed_mentions, { parse: [], replied_user: false });
      assert.deepEqual(call.payload.message_reference, { message_id: '1000', fail_if_not_exists: false });
      assert.equal(call.payload.nonce, hash('outbound:turn-output:0')); assert.equal(call.payload.enforce_nonce, true);
      assert.deepEqual([...call.form.keys()], ['payload_json', 'files[0]', 'files[1]', 'files[2]']);
      for (const [i, image] of IMAGES.entries()) await assertFile(call.form.get(`files[${i}]`), image);
    }
    for (const call of f.calls) {
      assert.ok(call.init.body instanceof FormData); assert.match(call.contentType, /^multipart\/form-data; boundary=/);
      assert.equal(new Headers(call.init.headers).has('content-type'), false, 'fetch, not the adapter, chooses the multipart boundary');
      assert.equal(call.init.redirect, 'error'); assert.ok(call.init.signal instanceof AbortSignal);
    }
    assert.equal(ledgerItem(f, 'inbound').status, 'delivered'); assert.equal(ledgerItem(f, 'outbound').status, 'delivered');
    assert.doesNotMatch(JSON.stringify([...f.settings.data]), /iVBOR|base64|content.*R0lGOD/);
    await f.service.reconcile(f.api); assert.equal(f.reads.length, 3); assert.equal(f.calls.length, kind === 'telegram' ? 3 : 1);
  });

  test(`${kind}: text chunks and multiple images preserve first-reply routing and transport-specific shape`, async t => {
    // Emoji straddles the nominal boundary; no split UTF-16 surrogate is sent.
    const limit = kind === 'telegram' ? 4000 : 2000;
    const answer = `${'a'.repeat(limit - 1)}😀tail @everyone <@101>`;
    const f = fixture(kind, { turn: receipt(undefined, `  ${answer}  `) }); t.after(() => f.service.close());
    await f.service.reconcile(f.api);
    const textCalls = f.calls.filter(call => call.payload?.text || call.payload?.content);
    assert.equal(textCalls.length, 2);
    assert.equal(textCalls.map(call => call.payload.text ?? call.payload.content).join(''), answer);
    for (const call of textCalls) assert.equal((call.payload.text ?? call.payload.content).isWellFormed(), true);
    assert.equal(f.events.indexOf('send'), 3, 'all bytes must be read before the first text chunk');
    if (kind === 'telegram') {
      assert.equal(f.calls.length, 5);
      assert.equal(Array.from(textCalls[0].payload.text).length, 4000);
      for (const [i, call] of textCalls.entries()) {
        assert.equal(call.url.endsWith('/sendMessage'), true);
        assert.equal(call.payload.chat_id, '-100'); assert.equal(call.payload.message_thread_id, 77);
        assert.deepEqual(call.payload.reply_parameters, i === 0 ? { message_id: 1000, allow_sending_without_reply: true } : undefined);
      }
      for (const [i, call] of f.calls.slice(2).entries()) {
        assert.equal(call.form.has('reply_parameters'), false);
        assert.equal(call.url.endsWith(`/${['sendPhoto', 'sendAnimation', 'sendDocument'][i]}`), true);
        await assertFile(call.form.get(['photo', 'animation', 'document'][i]), IMAGES[i]);
      }
    } else {
      assert.equal(f.calls.length, 2); assert.equal(textCalls[0].payload.content.length, 1999);
      for (const [i, call] of f.calls.entries()) {
        assert.equal(call.url.endsWith('/channels/400/messages'), true);
        assert.equal(call.payload.nonce, hash(`outbound:turn-output:${i}`)); assert.equal(call.payload.enforce_nonce, true);
        assert.deepEqual(call.payload.allowed_mentions, { parse: [], replied_user: false });
        assert.deepEqual(call.payload.message_reference, i === 0 ? { message_id: '1000', fail_if_not_exists: false } : undefined);
      }
      assert.ok(f.calls[0].form); assert.equal(f.calls[1].form, null); assert.equal(f.calls[1].payload.attachments, undefined);
      for (const [i, image] of IMAGES.entries()) await assertFile(f.calls[0].form.get(`files[${i}]`), image);
      assert.equal(f.calls[0].init.headers.Authorization, 'Bot 123:SECRET');
    }
  });

  test(`${kind}: restart converts write-ahead sending to unknown and never rereads or resends`, async t => {
    const f = fixture(kind); const outbound = { ...f.inbound, id: `out:${f.turn.id}`, direction: 'outbound', status: 'sending' };
    for (const records of [[outbound, f.inbound], [f.inbound, outbound]]) {
      f.settings.data.set('deliveries', records); await f.service.close();
      const restarted = f.create();
      try {
        await restarted.reconcile(f.api); await restarted.reconcile(f.api);
        assert.equal(ledgerItem(f, 'outbound').status, 'unknown');
        assert.equal(ledgerItem(f, 'outbound').error, `${kind}_delivery_outcome_unknown`);
        assert.equal(ledgerItem(f, 'inbound').status, 'unknown');
      } finally { await restarted.close(); }
    }
    t.after(() => f.service.close()); assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 0);
  });

  test(`${kind}: partial transport failure becomes unknown, never failed/delivered or automatically retried`, async t => {
    const f = fixture(kind, { turn: receipt(undefined, 'x'.repeat(kind === 'telegram' ? 4001 : 2001)), sendFailure: 2 });
    t.after(() => f.service.close()); await f.service.reconcile(f.api);
    assert.equal(f.calls.length, 2); assert.equal(ledgerItem(f, 'outbound').status, 'unknown');
    assert.equal(ledgerItem(f, 'outbound').error, `${kind}_request_failed`);
    await f.service.reconcile(f.api); assert.equal(ledgerItem(f, 'inbound').status, 'unknown');
    await f.service.close(); const restarted = f.create();
    try { await restarted.reconcile(f.api); } finally { await restarted.close(); }
    assert.equal(f.calls.length, 2); assert.equal(f.reads.length, 3);
    assert.doesNotMatch(JSON.stringify(await f.service.publicState()), /SECRET|private\.invalid/);
  });

  test(`${kind}: an uncertain image upload is unknown and never replayed`, async t => {
    const f = fixture(kind, { sendFailure: kind === 'telegram' ? 2 : 1 });
    t.after(() => f.service.close()); await f.service.reconcile(f.api);
    assert.equal(f.calls.length, kind === 'telegram' ? 2 : 1);
    assert.ok(f.calls.every(call => call.form), 'failure occurs in binary uploads, not text requests');
    if (kind === 'telegram') assert.equal(f.calls.at(-1).url.endsWith('/sendAnimation'), true);
    assert.equal(ledgerItem(f, 'outbound').status, 'unknown');
    await f.service.reconcile(f.api); await f.service.reconcile(f.api);
    await f.service.close();
    const restarted = f.create();
    try { await restarted.reconcile(f.api); } finally { await restarted.close(); }
    assert.equal(f.calls.length, kind === 'telegram' ? 2 : 1);
    assert.equal(ledgerItem(f, 'inbound').status, 'unknown');
  });

  test(`${kind}: text-only and empty results retain established delivery behavior without attachment capability`, async t => {
    for (const answer of ['plain reply', '']) {
      const f = fixture(kind, { turn: receipt([], answer), missingCapability: true }); t.after(() => f.service.close());
      await f.service.reconcile(f.api); assert.equal(f.calls.length, answer ? 1 : 0);
      assert.equal(ledgerItem(f, 'inbound').status, !answer && kind === 'telegram' ? 'succeeded' : 'delivered');
    }
  });
}

// Raw adapter shape/validation is also tested without a receipt/service fixture.
test('Telegram raw API preserves GIF animation, JPEG/PNG photos and WebP documents in root and zero-valued routes', async () => {
  for (const [image, method, field] of [
    [IMAGES[0], 'sendPhoto', 'photo'],
    [{ name: 'photo.jpg', mimeType: 'image/jpeg', bytes: JPEG }, 'sendPhoto', 'photo'],
    [IMAGES[1], 'sendAnimation', 'animation'],
    [IMAGES[2], 'sendDocument', 'document'],
  ]) {
    const calls = []; const api = createTelegramApi({ token: '123:SECRET', fetchImpl: async (url, init) => { calls.push(await wireRequest(url, init)); return json('telegram', {}); } });
    await api.sendImage({ chatId: 42, image });
    await api.sendImage({ chatId: 42, topicId: 0, replyToMessageId: 0, image });
    for (const call of calls) {
      assert.equal(call.url.endsWith(`/${method}`), true);
      await assertFile(call.form.get(field), image);
    }
    assert.deepEqual([...calls[0].form.keys()], ['chat_id', field]);
    assert.equal(calls[1].form.get('message_thread_id'), '0'); assert.equal(JSON.parse(calls[1].form.get('reply_parameters')).message_id, 0);
    assert.throws(() => api.sendImage({ chatId: 42, image: { ...image, bytes: Buffer.from('not an image') } }), /output_attachment_unsupported/);
    assert.equal(calls.length, 2);
  }
});

test('Discord raw API retains chatId fallback, explicit channel precedence, bounded nonces and suppressed invalid replies', async () => {
  const calls = []; const api = createDiscordApi({ token: 'SECRET', fetchImpl: async (url, init) => { calls.push(await wireRequest(url, init)); return json('discord', {}); } });
  await api.sendMessage({ chatId: '401', text: '@everyone', nonce: 'x'.repeat(40), replyToMessageId: 'not-a-snowflake' });
  await api.sendMessage({ channelId: '402', chatId: '401', images: [IMAGES[0]] });
  assert.equal(calls[0].url.endsWith('/channels/401/messages'), true); assert.equal(calls[0].payload.nonce.length, 25);
  assert.equal(calls[0].payload.message_reference, undefined); assert.deepEqual(calls[0].payload.allowed_mentions, { parse: [], replied_user: false });
  assert.equal(calls[1].url.endsWith('/channels/402/messages'), true); assert.equal(calls[1].payload.nonce, undefined);
  assert.equal(calls[1].payload.message_reference, undefined); await assertFile(calls[1].form.get('files[0]'), IMAGES[0]);
  for (const input of [{ channelId: '400' }, { channelId: '400', text: 'x'.repeat(2001) }, { channelId: '400', text: 'ok', images: {} }, { channelId: 'bad', text: 'ok' }, { channelId: '400', images: Array(11).fill(IMAGES[0]) }]) assert.throws(() => api.sendMessage(input), /discord_response_invalid/);
  const big = Buffer.alloc(OUTPUT_IMAGE_LIMITS.bytes); PNG.copy(big);
  const bigImage = { ...IMAGES[0], bytes: big };
  assert.throws(() => api.sendMessage({ channelId: '400', images: [bigImage, bigImage, IMAGES[0]] }), /discord_response_invalid/);
  assert.throws(() => api.sendMessage({ channelId: '400', images: [{ ...IMAGES[0], bytes: GIF }] }), /output_attachment_unsupported/);
  assert.equal(calls.length, 2);
});

test('ambiguous multipart POST failures are never retried by either raw transport API', async () => {
  for (const kind of ['telegram', 'discord']) for (const failure of ['network', 'http-500', 'invalid-json']) {
    let count = 0;
    const api = (kind === 'telegram' ? createTelegramApi : createDiscordApi)({ token: 'SECRET', fetchImpl: async () => {
      count++;
      if (failure === 'network') throw new Error('SECRET');
      return failure === 'http-500' ? new Response('private', { status: 500 }) : new Response('invalid json');
    } });
    const promise = kind === 'telegram' ? api.sendImage({ chatId: 42, image: IMAGES[1] }) : api.sendMessage({ channelId: '400', images: IMAGES });
    await assert.rejects(promise, error => [`${kind}_request_failed`, `${kind}_response_invalid`].includes(error.message));
    assert.equal(count, 1, `${kind} ${failure}`);
  }
});

test('exact descriptor count, per-image bytes and aggregate bounds are accepted; excess metadata never reads', { timeout: 15000 }, async () => {
  const ten = Array.from({ length: OUTPUT_IMAGE_LIMITS.count }, (_, i) => descriptor(IMAGES[0], `id-${i}`));
  assert.equal((await readOutputImages({ readAttachment: async () => encoded() }, receipt(ten))).length, 10);
  const bytes = Buffer.alloc(OUTPUT_IMAGE_LIMITS.bytes); PNG.copy(bytes);
  const image = { ...IMAGES[0], bytes };
  assert.equal(validateOutputImage(image).bytes.length, OUTPUT_IMAGE_LIMITS.bytes);
  const two = [descriptor(image, 'big-1'), descriptor(image, 'big-2')];
  const images = await readOutputImages({ readAttachment: async () => encoded(image) }, receipt(two));
  assert.equal(images.reduce((total, item) => total + item.bytes.length, 0), OUTPUT_IMAGE_LIMITS.aggregate);
  assert.deepEqual(images[0].bytes, bytes); assert.deepEqual(images[1].bytes, bytes);
});

test('readOutputImages aborts a stalled capability waiter and ignores its late successful result', { timeout: 2000 }, async () => {
  const gate = deferred(), entered = deferred(), controller = new AbortController(); let reads = 0;
  const reading = readOutputImages({ readAttachment: async () => { reads++; entered.resolve(); return gate.promise; } }, receipt(), controller.signal);
  await entered.promise; controller.abort(new Error('cancelled'));
  await assert.rejects(reading, /output_attachment_unavailable/);
  gate.resolve(encoded()); await new Promise(resolve => setImmediate(resolve)); assert.equal(reads, 1);
  await assert.rejects(readOutputImages({ readAttachment: () => assert.fail('preaborted signal must not read') }, receipt(), controller.signal), /cancelled/);
});

for (const kind of ['telegram', 'discord']) {
  test(`${kind}: shutdown during receipt read cancels waiting and late bytes cannot send`, { timeout: 2000 }, async () => {
    const gate = deferred(), entered = deferred();
    const f = fixture(kind, { readAttachment: () => { entered.resolve(); return gate.promise; } });
    const reading = f.service.reconcile(f.api);
    // Attach rejection handling before close aborts the Telegram reconcile.
    const settled = reading.catch(error => error);
    await entered.promise; await f.service.close(); await settled;
    gate.resolve(encoded()); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 0); assert.equal(f.reads.length, 1); assert.equal(ledgerItem(f, 'outbound'), undefined);
  });

  test(`${kind}: mapping deletion/reassignment during receipt read blocks late bytes and later reconcile`, { timeout: 3000 }, async t => {
    for (const action of ['delete', 'disable', 'reassign']) await t.test(action, async () => {
      const gate = deferred(), entered = deferred();
      const f = fixture(kind, { turn: receipt([descriptor()], 'must not send'), readAttachment: () => { entered.resolve(); return gate.promise; } });
      const reading = f.service.reconcile(f.api); await entered.promise;
      const change = action === 'delete' ? f.service.deleteMapping(f.route.id) : f.service.updateMapping(f.route.id, { enabled: action !== 'disable', ...(action === 'reassign' ? { agentId: 'other' } : {}) });
      // Changes serialize behind reconciliation, but revoke send authorization immediately.
      await new Promise(resolve => setImmediate(resolve)); gate.resolve(encoded());
      try {
        await reading; await change; await f.service.reconcile(f.api);
        assert.equal(f.calls.length, 0); assert.equal(ledgerItem(f, 'inbound').status, 'interrupted');
        assert.equal(ledgerItem(f, 'outbound'), undefined);
      } finally { gate.resolve(encoded()); await f.service.close(); }
    });
  });
}

for (const kind of ['telegram', 'discord']) {
  test(`${kind}: connection disable cancels a stalled receipt read without waiting for bytes`, { timeout: 2000 }, async () => {
    const entered = deferred(), gate = deferred();
    const f = fixture(kind, { readAttachment: () => { entered.resolve(); return gate.promise; } });
    const reading = f.service.reconcile(f.api); await entered.promise;
    await f.service.configure({ enabled: false }); await reading;
    gate.resolve(encoded()); await new Promise(resolve => setImmediate(resolve));
    await f.service.close();
    assert.equal(f.calls.length, 0); assert.equal(ledgerItem(f, 'outbound'), undefined);
  });
}

test('Telegram poll-driven route change aborts a stalled receipt read without waiting for capability completion', { timeout: 3000 }, async () => {
  const entered = deferred(), gate = deferred();
  const f = fixture('telegram', { readAttachment: () => { entered.resolve(); return gate.promise; } });
  await f.service.close();
  const connection = createTelegramConnection({ context: f.context, fetchImpl: async () => assert.fail('no transport or getUpdates after aborted preflight'), idleDelayMs: 1 });
  connection.start(); await entered.promise;
  await connection.configure({ enabled: false });
  gate.resolve(encoded()); await connection.close();
  assert.equal(f.calls.length, 0); assert.equal(ledgerItem(f, 'outbound'), undefined);
});

test('existing Switchboard per-connection reconcile routes Telegram and Discord outputs without crossing namespaces', async t => {
  const telegram = fixture('telegram', { turn: receipt([descriptor()], 'telegram answer') });
  const discordTurn = { ...receipt([descriptor()], 'discord answer'), id: 'discord-turn' };
  const discord = fixture('discord', { turn: discordTurn });
  await telegram.service.close(); await discord.service.close();
  const settings = telegram.settings;
  settings.data.set('connections', [{ id: 'default', name: 'Telegram', transport: 'telegram' }, { id: 'discord-peer', name: 'Discord', transport: 'discord' }]);
  for (const [key, value] of discord.settings.data) settings.data.set(`connection-discord-peer-${key}`, structuredClone(value));
  telegram.context.agents.turns.read = async id => id === discordTurn.id ? discordTurn : telegram.turn;
  telegram.context.agents.turns.readAttachment = async (turnId, artifactId) => {
    assert.ok([telegram.turn.id, discordTurn.id].includes(turnId)); assert.equal(artifactId, 'artifact-0'); return encoded();
  };
  const service = createSwitchboardService({ context: telegram.context }); t.after(() => service.close());
  const apiCalls = [];
  await service.reconcile({ sendMessage: async args => { apiCalls.push(['telegram-text', args]); }, sendImage: async args => { apiCalls.push(['telegram-image', args]); } });
  assert.equal(settings.data.get('connection-discord-peer-deliveries')[0].status, 'processing');
  await service.reconcile({ sendMessage: async args => { apiCalls.push(['discord', args]); } }, 'discord-peer');
  assert.deepEqual(apiCalls.map(([kind]) => kind), ['telegram-text', 'telegram-image', 'discord']);
  assert.equal(apiCalls[0][1].chatId, '-100'); assert.equal(apiCalls[0][1].topicId, 77);
  assert.equal(apiCalls[2][1].channelId, '400'); assert.equal(apiCalls[2][1].text, 'discord answer');
  // The existing API routes receipt ownership and outcomes per connection.
  assert.deepEqual(apiCalls[2][1].images[0].bytes, PNG);
  const state = await service.publicState();
  for (const connection of state.connections) assert.equal(connection.deliveries.find(item => item.direction === 'outbound').status, 'delivered');
  await assert.rejects(service.reconcile({}, 'missing'), /connection_not_found/);
});

for (const kind of ['telegram', 'discord']) for (const answer of ['', 'Here is the animation.']) {
  test(`${kind}: GIF-only attachment with ${answer ? 'text' : 'no text'} retains native bytes, first reply and restart idempotency`, async t => {
    const image = IMAGES[1];
    const f = fixture(kind, { turn: receipt([descriptor(image, 'gif-only')], answer), readAttachment: () => encoded(image) });
    t.after(() => f.service.close());
    await f.service.reconcile(f.api);
    const upload = f.calls.find(call => call.form);
    if (kind === 'telegram') {
      assert.equal(f.calls.length, answer ? 2 : 1);
      assert.equal(upload.url.endsWith('/sendAnimation'), true);
      assert.deepEqual([...upload.form.keys()].sort(), ['chat_id', 'message_thread_id', 'animation', ...(!answer ? ['reply_parameters'] : [])].sort());
      assert.equal(upload.form.get('message_thread_id'), '77');
      const firstReply = answer ? f.calls[0].payload.reply_parameters : JSON.parse(upload.form.get('reply_parameters'));
      assert.deepEqual(firstReply, { message_id: 1000, allow_sending_without_reply: true });
      await assertFile(upload.form.get('animation'), image);
    } else {
      assert.equal(f.calls.length, 1);
      assert.equal(upload.payload.content, answer || undefined);
      assert.deepEqual(upload.payload.message_reference, { message_id: '1000', fail_if_not_exists: false });
      assert.equal(upload.payload.enforce_nonce, true);
      await assertFile(upload.form.get('files[0]'), image);
    }
    assert.ok(upload.raw.includes(GIF), 'complete looping, two-frame GIF survives serialized multipart');
    assert.equal(ledgerItem(f, 'outbound').status, 'delivered');
    const sends = f.calls.length;
    await f.service.reconcile(f.api);
    await f.service.close();
    const restarted = f.create();
    try { await restarted.reconcile(f.api); } finally { await restarted.close(); }
    assert.equal(f.calls.length, sends);
    assert.equal(f.reads.length, 1);
  });
}
