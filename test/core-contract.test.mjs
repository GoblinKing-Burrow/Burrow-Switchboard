import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreRoot = path.resolve(process.env.BURROW_CORE_ROOT || path.join(root, '..', 'Burrow-Backend'));
async function memoryStore() { const settings = new Map(), secrets = new Map(); return { get: async (n,f=null)=>settings.has(n)?settings.get(n):f, set: async(n,v)=>(settings.set(n,structuredClone(v)),v), delete: async n=>settings.delete(n), getSecret: async n=>secrets.get(n)??null, setSecret: async(n,v)=>(secrets.set(n,String(v)),true), clearSecret: async n=>secrets.delete(n), hasSecret: async n=>secrets.has(n), close:async()=>{} }; }
test('current Core discovers and hosts Switchboard with external agent turns', async t => {
  const [{ discoverMods }, { startModHost }] = await Promise.all([import(pathToFileURL(path.join(coreRoot,'src/mod-runtime.mjs'))), import(pathToFileURL(path.join(coreRoot,'src/mod-host.mjs')))]);
  const runtimeRoot = await fs.mkdtemp('/tmp/burrow-switchboard-contract-'); const modsRoot = path.join(runtimeRoot,'mods'); await fs.mkdir(modsRoot,{recursive:true}); await fs.cp(root,path.join(modsRoot,'burrow-switchboard'),{recursive:true,filter:source=>path.basename(source)!=='.git'}); t.after(()=>fs.rm(runtimeRoot,{recursive:true,force:true}));
  const [mod] = await discoverMods({ runtimeRoot, logger:{warn(){}} }); assert.equal(mod.id,'burrow-switchboard'); assert.notEqual(mod.status,'failed',mod.error); assert.deepEqual(Object.keys(mod.ui),['settings']); assert.deepEqual(mod.contributions.settings.map(item=>item.id),['bots','diagnostics']); assert.deepEqual(mod.contributions.settings.map(item=>item.navigation.title),['Bots','Diagnostics']); assert.equal(mod.name,'Switchboard');
  const calls=[]; const host=startModHost({mod,store:await memoryStore(),logger:{debug(){},info(){},warn(){},error(){}},capabilities:{listAgents:async()=>[{id:'hatchet',name:'Hatchet',enabled:true}],submitExternalTurn:async input=>(calls.push(['submit',input]),{turn:{id:'turn-1',agentId:input.agentId,sessionId:input.sessionId,status:'queued',runId:null,result:null,error:null,createdAt:'2026-10-22T00:00:00Z',updatedAt:'2026-10-22T00:00:00Z',startedAt:null,completedAt:null},replayed:false}),readExternalTurn:async input=>(calls.push(['read',input]),{id:input.turnId,status:'succeeded',result:{answerText:'hello'},error:null})}}); t.after(()=>host.close());
  const activation=await host.activated; assert.equal(activation.tools.length,0); assert.ok(activation.some(item=>item.method==='GET'&&item.path==='/bootstrap'));
  const invoke=async(method,route,body=null,params={})=>{const entry=activation.find(item=>item.method===method&&item.path===route);assert.ok(entry,`${method} ${route}`);return host.invoke(entry.routeId,{auth:{enabled:false,authenticated:false},body,params,query:{},headers:{},method,path:route});};
  const bootstrap=await invoke('GET','/bootstrap'); assert.equal(bootstrap.body.coreAgentTurns.available,true); assert.equal(bootstrap.body.tokenConfigured,false);
  const configured=await invoke('PUT','/configuration',{enabled:false}); assert.equal(configured.body.tokenConfigured,false); assert.equal(configured.body.connections[0].id,'default'); assert.ok(activation.some(item=>item.method==='DELETE'&&item.path==='/connections/:connectionId'));
});

test('Telegram image bytes survive real Core capability validation, receipt acceptance and attachment handoff', async t => {
  const [{ createModCapabilities }, { createModExternalTurnDispatcher }, { sameExternalTurnInput }, { createTelegramConnection }] = await Promise.all([
    import(pathToFileURL(path.join(coreRoot, 'src/mod-capabilities.mjs'))),
    import(pathToFileURL(path.join(coreRoot, 'src/mod-external-turns.mjs'))),
    import(pathToFileURL(path.join(coreRoot, 'src/mod-external-turn-attachments.mjs'))),
    import('../server/telegram.mjs'),
  ]);
  const { createHash } = await import('node:crypto');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');
  const data = `data:image/png;base64,${png.toString('base64')}`;
  const rows = new Map(), keys = new Map(); let executions = 0, submittedBody;
  const store = {
    async create(input) {
      const key = `${input.ownerModId}:${input.idempotencyKey}`; const existing = keys.get(key);
      if (existing) { assert.ok(sameExternalTurnInput(existing, input)); return { turn: { ...existing }, replayed: true }; }
      const turn = { id: 'turn-1', ...structuredClone(input), status: 'queued', runId: null, result: null, error: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', startedAt: null, completedAt: null };
      rows.set(turn.id, turn); keys.set(key, turn); return { turn: { ...turn }, replayed: false };
    },
    async getByIdempotency(owner, key) { return keys.get(`${owner}:${key}`) || null; },
    async getOwned(owner, id) { const row = rows.get(id); return row?.ownerModId === owner ? { ...row } : null; },
    async markRunning(id, runId) { const row = rows.get(id); if (row.status !== 'queued') return null; Object.assign(row, { status: 'running', runId }); return { ...row }; },
    async complete(id, patch) { const row = rows.get(id); Object.assign(row, patch); return { ...row }; },
  };
  const stores = { agents: { get: async () => ({ id: 'hatchet', enabled: true }) }, models: {}, scheduledJobs: {}, conversations: {} };
  const dispatcher = createModExternalTurnDispatcher({ store, stores, resolveAgentRuntime: async () => ({}), executeTurn: async input => { executions++; submittedBody = input.body; return { ok: true, answerText: 'seen' }; } });
  t.after(() => dispatcher.close());
  const capabilities = createModCapabilities({ ownerModId: 'burrow-switchboard', stores, externalTurnDispatcher: dispatcher, resolveAgentRuntime: async () => ({}) });
  const settings = new Map(), attempts = []; let lost = false;
  const context = {
    settings: { get: async (key, fallback = null) => structuredClone(settings.has(key) ? settings.get(key) : fallback), set: async (key, value) => settings.set(key, structuredClone(value)) },
    secrets: { get: async () => 'local-test-only', has: async () => true },
    agents: { list: async () => [{ id: 'hatchet', enabled: true }], turns: {
      submit: async input => { attempts.push(structuredClone(input)); const accepted = await capabilities.submitExternalTurn(input); if (!lost) { lost = true; throw new Error('response_lost'); } return accepted; },
      read: turnId => capabilities.readExternalTurn({ turnId }),
    } },
    logger: { error() {} },
  };
  settings.set('mappings', [{ id: createHash('sha256').update('telegram:42:root').digest('hex').slice(0, 24), chatId: '42', topicId: null, chatTitle: 'DM', chatType: 'direct', agentId: 'hatchet', enabled: true }]);
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/getFile')) return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/pixel.png' } }), { status: 200 });
    if (url.startsWith('https://api.telegram.org/file/')) { assert.equal(init.redirect, 'error'); return new Response(png); }
    assert.fail('unexpected network operation');
  };
  let worker = createTelegramConnection({ context, fetchImpl }); t.after(() => worker.close());
  const update = { update_id: 99, message: { message_id: 99, chat: { id: 42, type: 'private' }, from: { id: 1 }, photo: [{ file_id: 'test', width: 1, height: 1 }] } };
  await assert.rejects(worker.processMessage(update, { id: '1' }), /response_lost/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(executions, 1); assert.equal(submittedBody.attachments[0].content, data);
  assert.deepEqual(rows.get('turn-1').attachments, attempts[0].attachments);
  assert.doesNotMatch(JSON.stringify(await worker.publicState()), /data:image|iVBORw0KGgo|submission/);
  await worker.close(); worker = createTelegramConnection({ context, fetchImpl });
  await worker.processMessage(update, { id: '1' });
  assert.deepEqual(attempts[1], attempts[0]); assert.equal(executions, 1);
  assert.equal((await worker.publicState()).deliveries[0].turnId, 'turn-1');
});
