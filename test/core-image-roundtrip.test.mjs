import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, inflateSync } from 'node:zlib';
import { createTelegramApi, createTelegramConnection } from '../server/telegram.mjs';

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
}
