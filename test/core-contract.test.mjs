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
