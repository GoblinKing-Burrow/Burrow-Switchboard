import test from 'node:test';
import { ANIMATED_GIF } from './fixtures/animated-gif.mjs';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { createTelegramApi, createTelegramConnection } from '../server/telegram.mjs';
import { createDiscordApi, createDiscordConnection } from '../server/discord.mjs';

const here = fileURLToPath(import.meta.url);
const switchboardRoot = path.resolve(path.dirname(here), '..');
const coreRoot = path.resolve(process.env.BURROW_CORE_ROOT || path.join(switchboardRoot, '..', 'Burrow-Backend'));
const coreImport = relative => import(pathToFileURL(path.join(coreRoot, relative)).href);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(check, label) {
  const deadline = Date.now() + 20_000;
  while (!await check()) {
    assert.ok(Date.now() < deadline, `Timed out waiting for ${label}`);
    await delay(20);
  }
}

function isolatedPostgresTarget() {
  // Reject anything except the private socket/URL minted by Core's fixture.
  // In particular URL options and duplicate host parameters must not override
  // pg's search_path or redirect it to another database.
  const env = process.env;
  const socket = env.BURROW_POSTGRES_HOST;
  const root = env.BURROW_RUNTIME_ROOT;
  assert.equal(env.BURROW_TRACE_ISOLATION, '1');
  assert.equal(env.BURROW_POSTGRES_MANAGED_INTEGRATION, '1');
  assert.ok(root && path.isAbsolute(root), 'owned runtime root required');
  assert.equal(socket, path.join(root, 'socket'));
  const target = new URL(env.BURROW_POSTGRES_TEST_URL);
  assert.equal(target.protocol, 'postgresql:');
  assert.equal(target.hostname, 'localhost');
  assert.equal(target.port, ''); assert.equal(target.password, ''); assert.equal(target.hash, '');
  assert.equal(target.pathname, '/postgres');
  assert.deepEqual([...target.searchParams.keys()], ['host']);
  assert.equal(target.searchParams.get('host'), socket);
  assert.equal(env.BURROW_POSTGRES_URL, env.BURROW_POSTGRES_TEST_URL);
  assert.equal(env.BURROW_ACCESS_TEST_SOCKET, socket);
  assert.equal(env.BURROW_POSTGRES_DATABASE, 'postgres');
  assert.equal(env.PGHOST, socket); assert.equal(env.PGPORT, '5432'); assert.equal(env.PGDATABASE, 'postgres');
  assert.ok(target.username);
  assert.equal(env.PGUSER, decodeURIComponent(target.username));
  assert.equal(env.BURROW_POSTGRES_USER, env.PGUSER);
  assert.equal(env.BURROW_ACCESS_TEST_USER, env.PGUSER);
  const fixtureKeys = new Set(['BURROW_ACCESS_TEST_SOCKET', 'BURROW_ACCESS_TEST_USER', 'BURROW_POSTGRES_TEST_URL', 'BURROW_POSTGRES_URL', 'BURROW_POSTGRES_HOST', 'BURROW_POSTGRES_DATABASE', 'BURROW_POSTGRES_USER', 'BURROW_POSTGRES_MANAGED_INTEGRATION', 'BURROW_POSTGRES_TEST_BIN', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER']);
  for (const [key, value] of Object.entries(env)) {
    if (value && (key === 'DATABASE_URL' || key.startsWith('BURROW_ACCESS_TEST_') || key.startsWith('BURROW_POSTGRES_') || /^PG[A-Z_0-9]+$/.test(key))) {
      assert.ok(fixtureKeys.has(key), `unexpected inherited database setting: ${key}`);
    }
  }
  return target;
}

// The normal Switchboard test command has no database environment. Re-execute
// only this file through Core's own lifecycle, which rejects inherited database
// settings, creates a unique Unix-socket cluster, and stops/removes it afterward.
// A Core-owned suite may instead supply its already isolated fixture.
if (!process.env.BURROW_TRACE_ISOLATION || !process.env.BURROW_POSTGRES_TEST_URL) {
  test('Core image roundtrip uses a disposable PostgreSQL fixture', { timeout: 120_000 }, async () => {
    const { runTestSuite } = await coreImport('scripts/test-runtime.mjs');
    // Node sets this in a test worker. If inherited, a nested `node --test`
    // silently skips all files as recursive rather than executing the proof.
    const { NODE_TEST_CONTEXT: _nodeTestContext, ...baseEnv } = process.env;
    const result = await runTestSuite({ argv: ['--test', here], baseEnv, disposablePostgres: true, timeoutMs: 90_000 });
    assert.equal(result.exitCode, 0, 'isolated image integration child failed');
  });
} else {
  test('Telegram image survives lost-response replay through real Core, native vision, artifact, transcript and reply', { timeout: 60_000 }, async t => {
    const target = isolatedPostgresTarget();
    const root = process.env.BURROW_RUNTIME_ROOT;

    const [{ createPostgresApplication }, { ensureAgentRoots }, { AGENT_PROFILE_KINDS },
      { createModExternalTurnDispatcher }, { createModCapabilities }, { PostgresModExternalTurnStore }] = await Promise.all([
      coreImport('src/postgres-composition.mjs'), coreImport('src/agent-registry.mjs'),
      coreImport('src/agent-profile-store.mjs'), coreImport('src/mod-external-turns.mjs'),
      coreImport('src/mod-capabilities.mjs'), coreImport('src/postgres-mod-external-turn-store.mjs'),
    ]);
    const { Pool } = createRequire(path.join(coreRoot, 'package.json'))('pg');
    const fixtureRoot = await mkdtemp(path.join(root, 'switchboard-image-'));
    const schema = `switchboard_image_${randomBytes(8).toString('hex')}`;
    const admin = new Pool({ connectionString: target.href });
    let pool, app, dispatcher, worker, capabilities;
    const originalFetch = globalThis.fetch;
    const modelRequests = [];
    const answer = 'The image is a red pixel. Details: https://example.test/images/pixel?view=full&source=telegram#result';
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          modelRequests.push({ method: req.method, path: req.url, headers: req.headers, body });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }] }));
        } catch {
          res.writeHead(400).end();
        }
      });
    });
    t.after(async () => {
      const errors = [];
      const clean = async fn => { try { await fn(); } catch (error) { errors.push(error); } };
      await clean(() => worker?.close());
      await clean(() => dispatcher?.close());
      capabilities?.dispose();
      globalThis.fetch = originalFetch;
      await clean(async () => {
        if (server.listening) {
          server.closeAllConnections();
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
      });
      await clean(() => app?.close());
      await clean(() => pool?.end());
      await clean(() => admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
      await clean(() => admin.end());
      await clean(() => rm(fixtureRoot, { recursive: true, force: true }));
      if (errors.length) throw new AggregateError(errors, 'fixture cleanup failed');
    });

    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: target.href, options: `-c search_path=${schema}` });
    app = await createPostgresApplication({ pool, encryptionKey: randomBytes(32), runtimeRoot: fixtureRoot, bootstrapSampleIdentities: false });
    assert.ok(app.stores.externalTurns instanceof PostgresModExternalTurnStore);
    const agent = await app.stores.agents.create({ id: 'fixture-agent', name: 'Fixture Agent' });
    await app.stores.profiles.replace(agent.id, AGENT_PROFILE_KINDS.map(kind => ({ kind, markdown: `# ${kind}\nAnswer briefly.` })));
    const agentRuntime = await ensureAgentRoots({ runtimeState: { workspaceRoot: path.join(fixtureRoot, 'workspace') }, agent });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const modelUrl = `http://127.0.0.1:${server.address().port}/v1`;
    // No ambient provider can be reached, even if a runtime default changes.
    globalThis.fetch = (resource, options) => {
      const url = new URL(resource instanceof Request ? resource.url : String(resource));
      assert.equal(url.protocol, 'http:');
      assert.equal(url.hostname, '127.0.0.1');
      assert.equal(url.port, String(server.address().port));
      return originalFetch(resource, options);
    };
    const model = await app.stores.models.save({ provider: 'fixture', apiType: 'openai-chat-completions', baseUrl: modelUrl, apiKey: 'local-model-fixture-only', acceptedInput: ['text', 'image'], models: [{ id: 'fake', selected: true }] });
    await app.stores.models.saveModelSelection({ agentId: agent.id, connectionId: model.id, model: 'fake' });
    const resolveAgentRuntime = async id => { assert.equal(id, agent.id); return agentRuntime; };
    // Intentionally omit executeTurn: the dispatcher's ordinary chat runtime is
    // the system under test, not an injected turn or model execution stub.
    dispatcher = createModExternalTurnDispatcher({ store: app.stores.externalTurns, stores: app.stores, rootDir: fixtureRoot, resolveAgentRuntime });
    capabilities = createModCapabilities({ ownerModId: 'burrow-switchboard', stores: app.stores, externalTurnDispatcher: dispatcher, resolveAgentRuntime });

    // Complete 1x1 RGBA PNG. Validate every chunk CRC and the decompressed pixel
    // so this proves actual supported image bytes rather than a signature stub.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
    assert.deepEqual(png.subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
    let offset = 8; const chunks = []; const idat = [];
    while (offset < png.length) {
      const length = png.readUInt32BE(offset);
      const type = png.subarray(offset + 4, offset + 8);
      const data = png.subarray(offset + 8, offset + 8 + length);
      assert.equal(crc32(Buffer.concat([type, data])), png.readUInt32BE(offset + 8 + length));
      chunks.push(type.toString('ascii'));
      if (type.toString('ascii') === 'IHDR') {
        assert.equal(data.readUInt32BE(0), 1); assert.equal(data.readUInt32BE(4), 1);
        assert.equal(data[8], 8); assert.equal(data[9], 6);
      }
      if (type.toString('ascii') === 'IDAT') idat.push(data);
      offset += length + 12;
    }
    assert.equal(offset, png.length);
    assert.deepEqual(chunks, ['IHDR', 'IDAT', 'IEND']);
    assert.deepEqual(inflateSync(Buffer.concat(idat)), Buffer.from([0, 255, 0, 0, 255]));
    const imageData = `data:image/png;base64,${png.toString('base64')}`;
    const token = '9000:LOCAL_TEST_TELEGRAM_TOKEN_ONLY';
    const settings = new Map(), secrets = new Map();
    const submissions = [], acceptances = [], telegramCalls = [];
    let approved = false;
    const context = {
      settings: {
        get: async (key, fallback = null) => structuredClone(settings.has(key) ? settings.get(key) : fallback),
        set: async (key, value) => { settings.set(key, structuredClone(value)); return value; },
      },
      secrets: {
        get: async key => secrets.get(key) ?? null,
        set: async (key, value) => { secrets.set(key, value); return true; },
        has: async key => secrets.has(key),
        clear: async key => secrets.delete(key),
      },
      agents: {
        list: () => capabilities.listAgents(),
        turns: {
          submit: async input => {
            submissions.push(structuredClone(input));
            const result = await capabilities.submitExternalTurn(input);
            acceptances.push(structuredClone(result));
            if (acceptances.length === 1) throw new Error('simulated_response_lost_after_acceptance');
            return result;
          },
          read: turnId => capabilities.readExternalTurn({ turnId }),
        },
      },
      logger: { error() {} },
    };
    const json = result => new Response(JSON.stringify({ ok: true, result }), { headers: { 'content-type': 'application/json' } });
    const fetchTelegram = async (url, init) => {
      telegramCalls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, redirect: init.redirect });
      assert.equal(init.redirect, 'error');
      if (url === `https://api.telegram.org/bot${token}/getFile`) {
        assert.equal(approved, true, 'getFile cannot run before route approval');
        assert.deepEqual(JSON.parse(init.body), { file_id: 'photo-large' });
        return json({ file_path: 'photos/red-pixel.png', file_size: png.length });
      }
      if (url === `https://api.telegram.org/file/bot${token}/photos/red-pixel.png`) {
        assert.equal(approved, true, 'download cannot run before route approval');
        assert.equal(init.method, 'GET');
        return new Response(png, { headers: { 'content-type': 'image/png' } });
      }
      if (url === `https://api.telegram.org/bot${token}/sendMessage`) return json({ message_id: 202, date: 1_700_000_001 });
      throw new Error('unexpected Telegram operation');
    };
    const bot = { id: '10', username: 'fixture_bot', displayName: 'Fixture Bot' };
    worker = createTelegramConnection({ context, fetchImpl: fetchTelegram });
    await worker.configure({ enabled: false, agentId: agent.id, token, bot });
    const caption = '@fixture_bot What is in this image?';
    const update = { update_id: 101, message: {
      message_id: 501, message_thread_id: 17, chat: { id: -1001, type: 'supergroup', title: 'Fixture Room' },
      from: { id: 42, first_name: 'Human' }, caption,
      caption_entities: [{ type: 'mention', offset: 0, length: '@fixture_bot'.length }],
      photo: [{ file_id: 'photo-small', width: 1, height: 1 }, { file_id: 'photo-large', width: 2, height: 2, file_size: png.length }],
      reply_to_message: { message_id: 500, from: { id: 42, first_name: 'Human' }, text: 'Please inspect this.' },
    } };
    const admission = structuredClone(update); admission.update_id = 100; admission.message.message_id = 499;
    await worker.processMessage(admission, bot);
    assert.equal(telegramCalls.length, 0); assert.equal(submissions.length, 0);
    let state = await worker.publicState();
    assert.equal(state.pending.length, 1); assert.equal(state.pending[0].chatId, '-1001');
    assert.equal(state.pending[0].topicId, null, 'group approval is for the root route');
    await worker.approve(state.pending[0].id, {});
    assert.equal(telegramCalls.length, 0, 'approval itself does not download');
    approved = true;

    await assert.rejects(worker.processMessage(update, bot), { message: 'simulated_response_lost_after_acceptance' });
    assert.equal(acceptances.length, 1); assert.equal(acceptances[0].replayed, false);
    const firstInput = submissions[0];
    assert.equal(firstInput.agentId, agent.id);
    assert.equal(firstInput.sessionId, 'telegram:-1001:17');
    assert.equal(firstInput.idempotencyKey, 'telegram-update-101');
    assert.equal(firstInput.displayMessage, 'What is in this image?');
    assert.match(firstInput.message, /Please inspect this\./);
    assert.deepEqual(firstInput.attachments, [{ name: 'telegram-image.png', type: 'image/png', size: png.length, encoding: 'data-url', content: imageData }]);
    assert.deepEqual(settings.get('deliveries')[0].submission, firstInput);
    assert.doesNotMatch(JSON.stringify(submissions), /api\.telegram\.org|LOCAL_TEST_TELEGRAM_TOKEN_ONLY/);
    assert.doesNotMatch(JSON.stringify(acceptances), /data:image|iVBORw0KGgo|LOCAL_TEST_TELEGRAM_TOKEN_ONLY/);
    const receiptId = acceptances[0].turn.id;
    let receipt;
    await until(async () => { receipt = await capabilities.readExternalTurn({ turnId: receiptId }); return !['queued', 'running'].includes(receipt.status); }, 'real Core receipt');
    assert.equal(receipt.status, 'succeeded', JSON.stringify({ status: receipt.status, error: receipt.error, requests: modelRequests.length }));
    assert.equal(receipt.result.answerText, answer);
    assert.ok(receipt.runId);
    assert.doesNotMatch(JSON.stringify(receipt), /data:image|iVBORw0KGgo|LOCAL_TEST_TELEGRAM_TOKEN_ONLY/);
    await until(() => dispatcher.pendingCount() === 0, 'dispatcher drain');
    state = await worker.publicState();
    assert.doesNotMatch(JSON.stringify(state), /submission|data:image|iVBORw0KGgo|LOCAL_TEST_TELEGRAM_TOKEN_ONLY|api\.telegram\.org/);

    // A genuinely new worker reuses the same persisted settings. The first
    // response was lost only after PostgreSQL accepted it; replay must return
    // that receipt, without re-download or a second normal execution.
    await worker.close();
    worker = createTelegramConnection({ context, fetchImpl: fetchTelegram });
    await worker.processMessage(update, bot);
    assert.deepEqual(submissions[1], firstInput);
    assert.equal(submissions.length, 2);
    assert.equal(acceptances[1].replayed, true);
    assert.equal(acceptances[1].turn.id, receiptId);
    assert.equal(acceptances[1].turn.runId, receipt.runId);
    assert.equal(settings.get('deliveries')[0].submission, null);
    assert.equal(settings.get('deliveries')[0].turnId, receiptId);
    assert.doesNotMatch(JSON.stringify(submissions), /api\.telegram\.org|LOCAL_TEST_TELEGRAM_TOKEN_ONLY/);
    assert.doesNotMatch(JSON.stringify(acceptances), /data:image|iVBORw0KGgo|LOCAL_TEST_TELEGRAM_TOKEN_ONLY/);
    assert.equal(telegramCalls.length, 2, 'one getFile and one download, including replay');

    const durable = await new PostgresModExternalTurnStore({ pool }).getOwned('burrow-switchboard', receiptId);
    assert.equal(durable.status, 'succeeded');
    assert.equal(durable.runId, receipt.runId);
    assert.deepEqual(durable.attachments, firstInput.attachments);
    assert.doesNotMatch(JSON.stringify(durable), /LOCAL_TEST_TELEGRAM_TOKEN_ONLY|api\.telegram\.org/);
    const rows = await pool.query('SELECT id, status, run_id FROM mod_external_turns WHERE owner_mod_id=$1', ['burrow-switchboard']);
    assert.equal(rows.rowCount, 1); assert.equal(rows.rows[0].id, receiptId); assert.equal(rows.rows[0].run_id, receipt.runId);

    const transcript = await app.stores.conversations.read({ agentId: agent.id, sessionId: firstInput.sessionId, limit: 100 });
    const users = transcript.filter(entry => entry.role === 'user');
    const assistants = transcript.filter(entry => entry.role === 'assistant');
    assert.equal(users.length, 1); assert.equal(assistants.length, 1);
    assert.equal(users[0].content, firstInput.displayMessage);
    assert.equal(assistants[0].content, answer);
    const manifest = users[0].metadata.attachments;
    assert.equal(manifest.length, 1); assert.equal(manifest[0].name, 'telegram-image.png');
    assert.ok(manifest[0].artifactPath.startsWith('artifacts/attachments/'));
    const artifact = path.resolve(agentRuntime.agentWorkspaceRoot, manifest[0].artifactPath);
    assert.ok(artifact.startsWith(path.resolve(agentRuntime.agentWorkspaceRoot) + path.sep));
    assert.deepEqual(await readFile(artifact), png);
    // Debug provider_history legitimately records the native image payload;
    // the readable chat messages retain only a manifest, not inline bytes.
    assert.doesNotMatch(JSON.stringify([...users, ...assistants]), /data:image|iVBORw0KGgo|LOCAL_TEST_TELEGRAM_TOKEN_ONLY/);
    assert.doesNotMatch(JSON.stringify(transcript), /LOCAL_TEST_TELEGRAM_TOKEN_ONLY|api\.telegram\.org/);

    assert.equal(modelRequests.length, 1, 'exactly one real model execution');
    assert.equal(modelRequests[0].method, 'POST'); assert.equal(modelRequests[0].path, '/v1/chat/completions');
    const parts = modelRequests[0].body.messages.flatMap(message => Array.isArray(message.content) ? message.content : []);
    const images = parts.filter(part => part.type === 'image_url');
    assert.equal(images.length, 1); assert.equal(images[0].image_url.url, imageData);
    assert.match(JSON.stringify(modelRequests[0].body.messages), /What is in this image\?/);
    assert.doesNotMatch(JSON.stringify(modelRequests), /LOCAL_TEST_TELEGRAM_TOKEN_ONLY|api\.telegram\.org/);
    // Wait briefly after the replay for any erroneously scheduled second run;
    // retain the one-call/one-row checks after this window.
    await delay(50);
    assert.equal(modelRequests.length, 1);

    // Reconciliation uses the real Telegram API adapter, with only its fetch
    // controlled. Assert the complete official sendMessage JSON, including the
    // group topic, reply target and untouched text link.
    const telegramApi = createTelegramApi({ token, fetchImpl: fetchTelegram });
    await worker.reconcile(telegramApi);
    const sent = telegramCalls.filter(call => call.url.endsWith('/sendMessage'));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body, { chat_id: '-1001', text: answer, message_thread_id: 17, reply_parameters: { message_id: 501, allow_sending_without_reply: true } });
    assert.equal(sent[0].method, 'POST');
    state = await worker.publicState();
    assert.equal(state.deliveries.find(item => item.id === 'in:101').status, 'delivered');
    assert.equal(state.deliveries.find(item => item.id === `out:${receiptId}`).status, 'delivered');
    assert.doesNotMatch(JSON.stringify(state), /submission|data:image|iVBORw0KGgo|LOCAL_TEST_TELEGRAM_TOKEN_ONLY|api\.telegram\.org/);
    await worker.reconcile(telegramApi);
    await worker.processMessage(update, bot);
    await delay(50);
    assert.equal(telegramCalls.filter(call => call.url.endsWith('/sendMessage')).length, 1);
    assert.equal(submissions.length, 2); assert.equal(modelRequests.length, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM mod_external_turns')).rows[0].count, 1);
    t.diagnostic('owned PostgreSQL; real Telegram ingress and Core default turn; one native vision request, durable replay, artifact/transcript, and official API reply verified');
  });

  for (const transport of ['telegram', 'discord']) for (const format of ['png', 'gif']) {
    test(`${transport} native generated ${format} travels from exact Core run through owned attachment read to binary multipart`, { timeout: 60_000 }, async t => {
      const target = isolatedPostgresTarget();
      const [{ createPostgresApplication }, { ensureAgentRoots }, { AGENT_PROFILE_KINDS },
        { createModExternalTurnDispatcher }, { createModCapabilities }, { PostgresModExternalTurnStore }] = await Promise.all([
        coreImport('src/postgres-composition.mjs'), coreImport('src/agent-registry.mjs'),
        coreImport('src/agent-profile-store.mjs'), coreImport('src/mod-external-turns.mjs'),
        coreImport('src/mod-capabilities.mjs'), coreImport('src/postgres-mod-external-turn-store.mjs'),
      ]);
      const { Pool } = createRequire(path.join(coreRoot, 'package.json'))('pg');
      const fixtureRoot = await mkdtemp(path.join(process.env.BURROW_RUNTIME_ROOT, `switchboard-${transport}-output-`));
      const schema = `switchboard_output_${randomBytes(8).toString('hex')}`;
      const admin = new Pool({ connectionString: target.href });
      let pool, app, dispatcher, capabilities, foreign, worker;
      const originalFetch = globalThis.fetch;
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
      // Different valid PNGs for adjacent runs make accidental byte leakage
      // visible even when all three receipts have the same MIME/size class.
      const pixel = rgba => {
        const idat = deflateSync(Buffer.from([0, ...rgba]));
        const chunk = Buffer.alloc(idat.length + 12);
        chunk.writeUInt32BE(idat.length); chunk.write('IDAT', 4); idat.copy(chunk, 8);
        chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
        return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(-12)]);
      };
      const outputBytes = format === 'gif' ? ANIMATED_GIF : png;
      const outputMime = `image/${format}`;
      const telegramMethod = format === 'gif' ? 'sendAnimation' : 'sendPhoto';
      const telegramField = format === 'gif' ? 'animation' : 'photo';
      const previousPng = pixel([0, 0, 255, 255]), laterPng = pixel([0, 255, 0, 255]);
      const modelRequests = [];
      const server = createServer((req, res) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          try {
            modelRequests.push({ method: req.method, path: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
            res.writeHead(200, { 'content-type': 'application/json' });
            const prompt = JSON.stringify(modelRequests.at(-1).body);
            const bytes = prompt.includes('previous-run') ? previousPng : prompt.includes('later-run') ? laterPng : outputBytes;
            res.end(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }));
          } catch { res.writeHead(400).end(); }
        });
      });
      t.after(async () => {
        const errors = [];
        const clean = async fn => { try { await fn(); } catch (error) { errors.push(error); } };
        await clean(() => worker?.close());
        await clean(() => dispatcher?.close());
        capabilities?.dispose(); foreign?.dispose();
        globalThis.fetch = originalFetch;
        await clean(async () => {
          if (server.listening) {
            server.closeAllConnections();
            await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
          }
        });
        await clean(() => app?.close());
        await clean(() => pool?.end());
        await clean(() => admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`));
        await clean(() => admin.end());
        await clean(() => rm(fixtureRoot, { recursive: true, force: true }));
        if (errors.length) throw new AggregateError(errors, 'output fixture cleanup failed');
      });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({ connectionString: target.href, options: `-c search_path=${schema}` });
      app = await createPostgresApplication({ pool, encryptionKey: randomBytes(32), runtimeRoot: fixtureRoot, bootstrapSampleIdentities: false });
      assert.ok(app.stores.externalTurns instanceof PostgresModExternalTurnStore);
      const agent = await app.stores.agents.create({ id: 'output-agent', name: 'Output Agent' });
      await app.stores.profiles.replace(agent.id, AGENT_PROFILE_KINDS.map(kind => ({ kind, markdown: `# ${kind}\nGenerate the requested image.` })));
      const runtime = await ensureAgentRoots({ runtimeState: { workspaceRoot: path.join(fixtureRoot, 'workspace') }, agent });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      // Only the local image provider is reachable. Transport HTTP has its own
      // explicit fetch double; neither route can fall through to live services.
      globalThis.fetch = (resource, options) => {
        const url = new URL(resource instanceof Request ? resource.url : String(resource));
        assert.equal(url.origin, `http://127.0.0.1:${server.address().port}`);
        return originalFetch(resource, options);
      };
      const model = await app.stores.models.save({ provider: 'fixture', apiType: 'openai-responses', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'local-image-provider-only', models: [{ id: 'gpt-image-1', selected: true, capabilities: { outputs: ['image'] } }] });
      await app.stores.models.saveModelSelection({ agentId: agent.id, connectionId: model.id, model: 'gpt-image-1' });
      const resolveAgentRuntime = async id => { assert.equal(id, agent.id); return runtime; };
      const dispatcherOptions = { stores: app.stores, rootDir: fixtureRoot, resolveAgentRuntime };
      // No executeTurn injection, fabricated receipt, transcript or artifact:
      // native Core generation writes the output and indexes its actual run.
      dispatcher = createModExternalTurnDispatcher({ ...dispatcherOptions, store: app.stores.externalTurns });
      const makeCapabilities = ownerModId => createModCapabilities({ ownerModId, stores: app.stores, externalTurnDispatcher: dispatcher, resolveAgentRuntime });
      capabilities = makeCapabilities('burrow-switchboard');
      foreign = makeCapabilities('foreign-output-reader');
      const settings = new Map(), secrets = new Map(), submissions = [], attachmentReads = [], network = [];
      const context = {
        settings: {
          get: async (key, fallback = null) => structuredClone(settings.has(key) ? settings.get(key) : fallback),
          set: async (key, value) => { settings.set(key, structuredClone(value)); return value; },
        },
        secrets: {
          get: async key => secrets.get(key) ?? null,
          set: async (key, value) => { secrets.set(key, value); return true; },
          has: async key => secrets.has(key), clear: async key => secrets.delete(key),
        },
        agents: { list: () => capabilities.listAgents(), turns: {
          submit: async input => { submissions.push(structuredClone(input)); return capabilities.submitExternalTurn(input); },
          read: turnId => capabilities.readExternalTurn({ turnId }),
          readAttachment: async (turnId, attachmentId) => {
            attachmentReads.push({ turnId, attachmentId });
            return capabilities.readExternalTurnAttachment({ turnId, attachmentId });
          },
        } },
        logger: { error() {} },
      };
      const token = transport === 'telegram' ? '9000:LOCAL_OUTPUT_TOKEN_ONLY' : 'LOCAL_DISCORD_OUTPUT_TOKEN_ONLY';
      const fetchTransport = async (url, init) => {
        // Serialize the real adapter's FormData to a wire request, then parse
        // that binary multipart body, rather than merely checking API arguments.
        const request = new Request(url, init);
        const wire = Buffer.from(await request.arrayBuffer());
        const contentType = request.headers.get('content-type');
        const call = { url, method: request.method, contentType, wire };
        network.push(call);
        assert.equal(call.method, 'POST');
        if (contentType?.startsWith('multipart/form-data; boundary=')) {
          assert.ok(wire.includes(outputBytes), 'wire body contains exact generated bytes, not base64/URL');
          assert.ok(!wire.includes(Buffer.from(outputBytes.toString('base64'))));
          call.form = await new Response(wire, { headers: { 'content-type': contentType } }).formData();
        } else {
          assert.match(contentType, /application\/json/);
          call.json = JSON.parse(wire.toString('utf8'));
        }
        if (transport === 'telegram') {
          assert.ok([`https://api.telegram.org/bot${token}/sendMessage`, `https://api.telegram.org/bot${token}/${telegramMethod}`].includes(url), 'only official Telegram output methods allowed');
          assert.equal(init.redirect, 'error');
          return new Response(JSON.stringify({ ok: true, result: { message_id: 901 + network.length, date: 1_700_000_000 } }), { headers: { 'content-type': 'application/json' } });
        }
        assert.equal(url, 'https://discord.com/api/v10/channels/300/messages');
        assert.equal(request.headers.get('authorization'), `Bot ${token}`);
        return new Response(JSON.stringify({ id: String(901 + network.length), channel_id: '300' }), { headers: { 'content-type': 'application/json' } });
      };
      const bot = { id: '10', username: 'fixture_bot', displayName: 'Fixture Bot', bot: true };
      worker = transport === 'telegram' ? createTelegramConnection({ context, fetchImpl: fetchTransport }) : createDiscordConnection({ context, fetchImpl: fetchTransport });
      await worker.configure({ enabled: transport === 'discord', agentId: agent.id, token, bot });
      const event = transport === 'telegram'
        ? { update_id: 701, message: { message_id: 501, message_thread_id: 17, chat: { id: -1001, type: 'supergroup', title: 'Image Room' }, from: { id: 42, first_name: 'Human' }, text: '@fixture_bot Generate an image of a red pixel.', entities: [{ type: 'mention', offset: 0, length: '@fixture_bot'.length }] } }
        : { id: '501', channel_id: '300', guild_id: '200', channel: { id: '300', guild_id: '200', type: 11, parent_id: '299', name: 'Image Thread' }, author: { id: '42', username: 'human' }, content: '<@10> Generate an image of a red pixel.', mentions: [{ id: '10' }] };
      await worker.processMessage(event, bot);
      let state = await worker.publicState();
      assert.equal(state.pending.length, 1);
      assert.equal(network.length, 0); assert.equal(submissions.length, 0);
      await worker.approve(state.pending[0].id, {});
      const sessionId = transport === 'telegram' ? 'telegram:-1001:17' : 'discord:default:300';
      const terminal = async accepted => {
        let turn;
        await until(async () => { turn = await capabilities.readExternalTurn({ turnId: accepted.turn.id }); return !['queued', 'running'].includes(turn.status); }, `${transport} image receipt`);
        assert.equal(turn.status, 'succeeded', JSON.stringify({ turn, modelRequests }));
        await until(() => dispatcher.pendingCount() === 0, 'image dispatcher drain');
        return turn;
      };
      const generate = marker => capabilities.submitExternalTurn({ agentId: agent.id, sessionId, message: `Generate an image: ${marker}`, idempotencyKey: `${transport}-${marker}` }).then(terminal);
      const previous = await generate('previous-run');
      await worker.processMessage(event, bot);
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].sessionId, sessionId);
      assert.equal(submissions[0].attachments, undefined, 'text request has no inbound image to echo');
      state = await worker.publicState();
      const inbound = state.deliveries.find(item => item.direction === 'inbound');
      assert.ok(inbound.turnId);
      const receipt = await terminal({ turn: { id: inbound.turnId } });
      const later = await generate('later-run');
      assert.equal(modelRequests.length, 3);
      for (const request of modelRequests) {
        assert.equal(request.method, 'POST'); assert.equal(request.path, '/v1/images/generations');
        assert.equal(request.body.model, 'gpt-image-1');
      }
      const [descriptor] = receipt.result.attachments;
      assert.equal(receipt.result.attachments.length, 1);
      assert.deepEqual(Object.keys(descriptor).sort(), ['id', 'mimeType', 'name', 'sizeBytes']);
      assert.ok(descriptor.id.startsWith('artifacts/generated/'));
      assert.equal(descriptor.mimeType, outputMime); assert.equal(descriptor.sizeBytes, outputBytes.length);
      assert.ok(descriptor.name.endsWith(`.${format}`));
      assert.notEqual(receipt.runId, previous.runId); assert.notEqual(receipt.runId, later.runId);
      assert.notEqual(descriptor.id, previous.result.attachments[0].id);
      assert.notEqual(descriptor.id, later.result.attachments[0].id);
      await assert.rejects(foreign.readExternalTurnAttachment({ turnId: receipt.id, attachmentId: descriptor.id }), /mod_external_turn_not_found/);
      for (const other of [previous, later]) await assert.rejects(capabilities.readExternalTurnAttachment({ turnId: receipt.id, attachmentId: other.result.attachments[0].id }), /mod_external_turn_attachment_not_found/);
      assert.doesNotMatch(JSON.stringify(receipt), /base64|data:image|iVBORw0KGgo|R0lGODlh|LOCAL_.*TOKEN|local-image-provider-only/);
      const transcript = await app.stores.conversations.read({ agentId: agent.id, sessionId, limit: 100 });
      const assistant = transcript.find(entry => entry.role === 'assistant' && entry.runId === receipt.runId);
      assert.ok(assistant, 'actual assistant entry for exact run exists');
      assert.equal(assistant.metadata.outputArtifacts.length, 1);
      assert.equal(assistant.metadata.outputArtifacts[0].storageReference, descriptor.id);
      assert.doesNotMatch(JSON.stringify(transcript.filter(entry => ['user', 'assistant'].includes(entry.role))), /data:image|iVBORw0KGgo|R0lGODlh|LOCAL_.*TOKEN/);

      // Reopen both durable receipt store and dispatcher before delivery. Reads
      // through the service must retrieve retained bytes, not an in-memory result.
      await dispatcher.close(); capabilities.dispose(); foreign.dispose();
      dispatcher = createModExternalTurnDispatcher({ ...dispatcherOptions, store: new PostgresModExternalTurnStore({ pool }) });
      capabilities = makeCapabilities('burrow-switchboard'); foreign = makeCapabilities('foreign-output-reader');
      assert.deepEqual((await capabilities.readExternalTurn({ turnId: receipt.id })).result.attachments, [descriptor]);
      const attachment = await capabilities.readExternalTurnAttachment({ turnId: receipt.id, attachmentId: descriptor.id });
      assert.deepEqual(attachment, { name: descriptor.name, mimeType: outputMime, sizeBytes: outputBytes.length, encoding: 'base64', content: outputBytes.toString('base64') });
      const replay = await capabilities.submitExternalTurn(submissions[0]);
      assert.equal(replay.replayed, true); assert.equal(replay.turn.id, receipt.id);
      const api = transport === 'telegram' ? createTelegramApi({ token, fetchImpl: fetchTransport }) : createDiscordApi({ token, fetchImpl: fetchTransport });
      await worker.reconcile(api);
      assert.deepEqual(attachmentReads, [{ turnId: receipt.id, attachmentId: descriptor.id }], 'service used the real owned attachment API for the exact receipt');
      const multipart = network.filter(call => call.form);
      assert.equal(multipart.length, 1, 'exactly one generated image upload');
      const upload = multipart[0];
      const files = [...upload.form.entries()].filter(([, value]) => typeof value !== 'string');
      assert.equal(files.length, 1);
      const [[field, file]] = files;
      assert.equal(file.name, descriptor.name); assert.equal(file.type, descriptor.mimeType);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), outputBytes);
      if (transport === 'telegram') {
        assert.equal(upload.url, `https://api.telegram.org/bot${token}/${telegramMethod}`);
        assert.equal(field, telegramField); assert.equal(upload.form.get('chat_id'), '-1001');
        assert.equal(upload.form.get('message_thread_id'), '17');
        // Text and image may be separate sends; exactly the first reply should
        // reference the originating message, never a previous/later Core run.
        const first = network[0];
        const reply = first.form ? JSON.parse(first.form.get('reply_parameters')) : first.json.reply_parameters;
        assert.deepEqual(reply, { message_id: 501, allow_sending_without_reply: true });
      } else {
        assert.equal(field, 'files[0]');
        const payload = JSON.parse(upload.form.get('payload_json'));
        assert.deepEqual(payload.allowed_mentions, { parse: [], replied_user: false });
        assert.equal(payload.attachments.length, 1);
        assert.equal(String(payload.attachments[0].id), '0'); assert.equal(payload.attachments[0].filename, descriptor.name);
        const first = network[0];
        const firstPayload = first.form ? JSON.parse(first.form.get('payload_json')) : first.json;
        assert.deepEqual(firstPayload.message_reference, { message_id: '501', fail_if_not_exists: false });
        assert.ok(firstPayload.nonce); assert.equal(firstPayload.enforce_nonce, true);
      }
      state = await worker.publicState();
      assert.equal(state.deliveries.find(item => item.id === `out:${receipt.id}`).status, 'delivered');
      assert.equal(state.deliveries.find(item => item.direction === 'inbound').status, 'delivered');
      assert.doesNotMatch(JSON.stringify(state), /submission|base64|data:image|iVBORw0KGgo|R0lGODlh|LOCAL_.*TOKEN|local-image-provider-only/);
      assert.doesNotMatch(JSON.stringify([...settings.values()]), /data:image|iVBORw0KGgo|R0lGODlh|LOCAL_.*TOKEN|local-image-provider-only/);
      const sendCount = network.length;
      await worker.reconcile(api);
      await worker.close();
      worker = transport === 'telegram' ? createTelegramConnection({ context, fetchImpl: fetchTransport }) : createDiscordConnection({ context, fetchImpl: fetchTransport });
      await worker.reconcile(api);
      await worker.processMessage(event, bot);
      await worker.reconcile(api);
      await delay(50);
      assert.equal(network.length, sendCount, 'reconcile and new worker replay never resend');
      assert.equal(attachmentReads.length, 1); assert.equal(submissions.length, 1); assert.equal(modelRequests.length, 3);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM mod_external_turns')).rows[0].count, 3);
      t.diagnostic(`owned PostgreSQL; native image model and exact-run artifact; real ${transport} service/readAttachment/API; serialized binary multipart and durable no-resend verified`);
    });
  }

  for (const transport of ['telegram', 'discord']) {
    test(`${transport} Forge GIF explicit reattach in a later external turn is delivered once per turn`, { timeout: 60_000 }, async t => {
      const target = isolatedPostgresTarget();
      const [{ createPostgresApplication }, { ensureAgentRoots }, { createModExternalTurnDispatcher },
        { createModCapabilities }, { default: PostgresForgeStore }, { configureForgeStore },
        { createExecutionContext }, { actionFromNativeToolCall }, { executeReviewedProposalActions }] = await Promise.all([
        coreImport('src/postgres-composition.mjs'), coreImport('src/agent-registry.mjs'), coreImport('src/mod-external-turns.mjs'),
        coreImport('src/mod-capabilities.mjs'), coreImport('src/postgres-forge-store.mjs'), coreImport('src/forge-agent-tools.mjs'),
        coreImport('src/execution-context.mjs'), coreImport('src/action-proposal.mjs'), coreImport('src/proposal-execution.mjs'),
      ]);
      const { Pool } = createRequire(path.join(coreRoot, 'package.json'))('pg');
      const root = await mkdtemp(path.join(process.env.BURROW_RUNTIME_ROOT, 'switchboard-forge-'));
      const schema = `switchboard_forge_${randomBytes(8).toString('hex')}`;
      const admin = new Pool({ connectionString: target.href });
      let pool, app, dispatcher, capabilities, worker, forge;
      t.after(async () => {
        await worker?.close(); await dispatcher?.close(); capabilities?.dispose();
        if (forge) await Promise.all([...forge.pending]);
        configureForgeStore(null); await app?.close(); await pool?.end();
        await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
        await rm(root, { recursive: true, force: true });
      });
      await admin.query(`CREATE SCHEMA ${schema}`);
      pool = new Pool({ connectionString: target.href, options: `-c search_path=${schema}` });
      app = await createPostgresApplication({ pool, encryptionKey: randomBytes(32), runtimeRoot: root, bootstrapSampleIdentities: false });
      const agent = await app.stores.agents.create({ id: 'forge-agent', name: 'Forge Agent' });
      const runtime = await ensureAgentRoots({ runtimeState: { workspaceRoot: path.join(root, 'workspace') }, agent });
      const resolveAgentRuntime = async id => { assert.equal(id, agent.id); return runtime; };
      let generations = 0, jobId, artifactId;
      forge = await new PostgresForgeStore({ pool, runtimeRoot: root, resolveAgent: resolveAgentRuntime,
        connections: [{ id: 'fixture', apiType: 'openai-responses', models: [{ id: 'image', acceptedOutput: ['image'] }] }],
        resolveConfig: async () => ({ api: 'openai-responses', capabilities: { outputs: ['image'] } }),
        adapterFactory: () => ({ complete: async () => {
          generations++;
          return { ok: true, outputArtifacts: [{ kind: 'image', name: 'animated.gif', mimeType: 'image/gif', source: { bytes: ANIMATED_GIF } }] };
        } }),
      }).init();
      configureForgeStore(forge);
      // Use Core's native action executor, with scripted decisions in place of a
      // model provider. The dispatcher, run IDs, Forge store and receipts are real.
      dispatcher = createModExternalTurnDispatcher({ store: app.stores.externalTurns, stores: app.stores, rootDir: root, resolveAgentRuntime,
        executeTurn: async ({ body }) => {
          try {
          const executionContext = createExecutionContext({ agentId: agent.id, agentRuntime: runtime, sessionId: body.sessionId,
            parentRunId: body.runId, workspaceRoot: root, agentWorkspaceRoot: runtime.agentWorkspaceRoot });
          const execute = async (name, args, id) => {
            const action = actionFromNativeToolCall({ id, name, arguments: args });
            const result = await executeReviewedProposalActions({ actions: [action], reviews: [{ index: 0, status: 'allowed' }], executionContext });
            const output = result.nativeToolResults[0]; assert.equal(output.ok, true, JSON.stringify(output)); return output;
          };
          if (!jobId) {
            const result = await execute('forge_create_job', { mode: 'image', connectionId: 'fixture', modelId: 'image', prompt: 'animated pixel', idempotencyKey: 'one-generation' }, 'create');
            jobId = result.job.id; artifactId = result.job.artifacts[0].id;
          } else {
            const args = { jobId, artifactId };
            const first = await execute('forge_attach_artifact', args, 'attach-1');
            const repeat = await execute('forge_attach_artifact', args, 'attach-2');
            assert.equal(repeat.attachment.id, first.attachment.id, 'same-turn attach reuses its delivery');
          }
          return { ok: true, answerText: 'Here is the GIF.' };
          } catch (error) { t.diagnostic(`native action failure: ${error.stack}`); throw error; }
        } });
      capabilities = createModCapabilities({ ownerModId: 'burrow-switchboard', stores: app.stores, externalTurnDispatcher: dispatcher, resolveAgentRuntime });
      const settings = new Map(), secrets = new Map(), submissions = [], reads = [], network = [];
      const context = {
        settings: { get: async (k, fallback = null) => structuredClone(settings.has(k) ? settings.get(k) : fallback), set: async (k, v) => { settings.set(k, structuredClone(v)); return v; } },
        secrets: { get: async k => secrets.get(k) ?? null, set: async (k, v) => { secrets.set(k, v); return true; }, has: async k => secrets.has(k), clear: async k => secrets.delete(k) },
        agents: { list: () => capabilities.listAgents(), turns: {
          submit: async input => { submissions.push(structuredClone(input)); return capabilities.submitExternalTurn(input); },
          read: turnId => capabilities.readExternalTurn({ turnId }),
          readAttachment: async (turnId, attachmentId) => { reads.push({ turnId, attachmentId }); return capabilities.readExternalTurnAttachment({ turnId, attachmentId }); },
        } }, logger: { error() {} },
      };
      const token = transport === 'telegram' ? '9000:LOCAL_FORGE_TOKEN_ONLY' : 'LOCAL_FORGE_DISCORD_TOKEN_ONLY';
      const fetchTransport = async (url, init) => {
        const request = new Request(url, init), wire = Buffer.from(await request.arrayBuffer());
        const contentType = request.headers.get('content-type');
        const call = { url, wire, form: contentType?.startsWith('multipart/form-data;') ? await new Response(wire, { headers: { 'content-type': contentType } }).formData() : null };
        if (!call.form) call.json = JSON.parse(wire.toString('utf8'));
        network.push(call);
        if (transport === 'telegram') {
          assert.ok([`https://api.telegram.org/bot${token}/sendMessage`, `https://api.telegram.org/bot${token}/sendAnimation`].includes(url));
          assert.equal(init.redirect, 'error');
          return new Response(JSON.stringify({ ok: true, result: { message_id: 900 + network.length, date: 1700000000 } }), { headers: { 'content-type': 'application/json' } });
        }
        assert.equal(url, 'https://discord.com/api/v10/channels/300/messages');
        assert.equal(request.headers.get('authorization'), `Bot ${token}`);
        return new Response(JSON.stringify({ id: String(900 + network.length), channel_id: '300' }), { headers: { 'content-type': 'application/json' } });
      };
      const bot = { id: '10', username: 'fixture_bot', displayName: 'Fixture Bot', bot: true };
      const makeWorker = () => transport === 'telegram' ? createTelegramConnection({ context, fetchImpl: fetchTransport }) : createDiscordConnection({ context, fetchImpl: fetchTransport });
      await app.stores.conversations.writeMetadata({ agentId: agent.id, sessionId: transport === 'telegram' ? 'telegram:-1001:17' : 'discord:default:300' });
      worker = makeWorker(); await worker.configure({ enabled: transport === 'discord', agentId: agent.id, token, bot });
      const event = n => transport === 'telegram'
        ? { update_id: 700 + n, message: { message_id: 500 + n, message_thread_id: 17, chat: { id: -1001, type: 'supergroup', title: 'Forge Room' }, from: { id: 42, first_name: 'Human' }, text: '@fixture_bot Send GIF', entities: [{ type: 'mention', offset: 0, length: '@fixture_bot'.length }] } }
        : { id: String(500 + n), channel_id: '300', guild_id: '200', channel: { id: '300', guild_id: '200', type: 11, parent_id: '299', name: 'Forge Thread' }, author: { id: '42', username: 'human' }, content: '<@10> Send GIF', mentions: [{ id: '10' }] };
      await worker.processMessage(event(1), bot);
      const state = await worker.publicState(); assert.equal(state.pending.length, 1);
      await worker.approve(state.pending[0].id, {});
      const api = transport === 'telegram' ? createTelegramApi({ token, fetchImpl: fetchTransport }) : createDiscordApi({ token, fetchImpl: fetchTransport });
      const receipts = [];
      for (const n of [1, 2]) {
        await worker.processMessage(event(n), bot);
        const current = await worker.publicState();
        const inbound = current.deliveries.find(item => item.id === `in:${transport === 'telegram' ? 700 + n : 500 + n}`);
        assert.ok(inbound?.turnId, JSON.stringify(current.deliveries));
        let receipt;
        await until(async () => { receipt = await capabilities.readExternalTurn({ turnId: inbound.turnId }); return !['queued', 'running'].includes(receipt.status); }, 'Forge external turn');
        assert.equal(receipt.status, 'succeeded', JSON.stringify(receipt));
        await until(() => dispatcher.pendingCount() === 0, 'Forge dispatcher drain');
        assert.equal(receipt.result.attachments.length, 1, 'one attachment per run despite repeated attach');
        receipts.push(receipt);
        const start = network.length;
        await worker.reconcile(api);
        const sends = network.slice(start), uploads = sends.filter(call => call.form);
        assert.equal(uploads.length, 1);
        const upload = uploads[0], files = [...upload.form.entries()].filter(([, v]) => typeof v !== 'string');
        assert.equal(files.length, 1); const [[field, file]] = files;
        assert.equal(field, transport === 'telegram' ? 'animation' : 'files[0]');
        assert.equal(file.type, 'image/gif'); assert.deepEqual(Buffer.from(await file.arrayBuffer()), ANIMATED_GIF);
        assert.ok(upload.wire.includes(ANIMATED_GIF));
        const first = sends[0];
        if (transport === 'telegram') {
          assert.equal(upload.url, `https://api.telegram.org/bot${token}/sendAnimation`);
          assert.equal(upload.form.get('chat_id'), '-1001'); assert.equal(upload.form.get('message_thread_id'), '17');
          const reply = first.form ? JSON.parse(first.form.get('reply_parameters')) : first.json.reply_parameters;
          assert.deepEqual(reply, { message_id: 500 + n, allow_sending_without_reply: true });
        } else {
          const payload = first.form ? JSON.parse(first.form.get('payload_json')) : first.json;
          assert.deepEqual(payload.message_reference, { message_id: String(500 + n), fail_if_not_exists: false });
          assert.deepEqual(payload.allowed_mentions, { parse: [], replied_user: false });
        }
      }
      assert.notEqual(receipts[0].runId, receipts[1].runId);
      assert.equal(generations, 1, 'reattach must not regenerate');
      assert.deepEqual(reads.map(r => r.turnId), receipts.map(r => r.id));
      assert.deepEqual(reads.map(r => r.attachmentId), receipts.map(r => r.result.attachments[0].id));
      const count = network.length;
      for (const input of submissions) { const replay = await capabilities.submitExternalTurn(input); assert.equal(replay.replayed, true); }
      await worker.reconcile(api); await worker.close(); worker = makeWorker();
      await worker.reconcile(api); await worker.processMessage(event(1), bot); await worker.processMessage(event(2), bot); await worker.reconcile(api);
      await delay(50);
      assert.equal(network.length, count, 'replay/restart cannot resend');
      assert.equal(generations, 1); assert.equal(submissions.length, 2); assert.equal(reads.length, 2);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM mod_external_turns')).rows[0].count, 2);
      t.diagnostic(`owned PostgreSQL; native Forge create/reattach with scripted actions; ${transport} exact GIF uploads, routing and replay verified`);
    });
  }

}
