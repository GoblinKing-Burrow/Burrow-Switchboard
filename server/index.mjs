import { createSwitchboardService } from './connections.mjs';

function requireOperator(request) {
  if (request?.auth?.enabled === true && request.auth.authenticated !== true) throw Object.assign(new Error('operator_authentication_required'), { statusCode: 401 });
}
function response(status, body) { return { status, headers: { 'cache-control': 'no-store' }, body }; }
function failure(error) {
  const status = Number(error?.statusCode);
  return response(status >= 400 && status < 500 ? status : 500, { ok: false, error: status >= 400 && status < 500 ? error.message : 'switchboard_request_failed' });
}
function route(handler) {
  return async request => {
    try { requireOperator(request); return response(200, { ok: true, ...await handler(request) }); }
    catch (error) { return failure(error); }
  };
}

export async function activate(context, options = {}) {
  const service = createSwitchboardService({ ...options, context });
  context.api.get('/bootstrap', route(() => service.publicState()));
  context.api.get('/configuration', route(() => service.publicState()));
  context.api.put('/configuration', route(request => service.configure(request.body)));
  context.api.post('/configuration/token/clear', route(() => service.clearToken()));
  context.api.post('/pending/:id/approve', route(request => service.approve(String(request.params?.id || ''), request.body)));
  context.api.post('/pending/:id/deny', route(request => service.deny(String(request.params?.id || ''))));
  context.api.put('/mappings/:id', route(request => service.updateMapping(String(request.params?.id || ''), request.body)));
  context.api.delete('/mappings/:id', route(request => service.deleteMapping(String(request.params?.id || ''))));
  const connectionId = request => String(request.params?.connectionId || '');
  context.api.post('/connections', route(request => service.createConnection(request.body)));
  context.api.put('/connections/:connectionId', route(request => service.configureConnection(connectionId(request), request.body)));
  context.api.delete('/connections/:connectionId', route(request => service.removeConnection(connectionId(request))));
  context.api.post('/connections/:connectionId/token/clear', route(request => service.clearConnectionToken(connectionId(request))));
  context.api.put('/connections/:connectionId/servers/:guildId', route(request => service.configureConnectionServer(connectionId(request), String(request.params?.guildId || ''), request.body)));
  context.api.delete('/connections/:connectionId/servers/:guildId', route(request => service.deleteConnectionServer(connectionId(request), String(request.params?.guildId || ''))));
  context.api.post('/connections/:connectionId/pending/:id/approve', route(request => service.approveConnection(connectionId(request), String(request.params?.id || ''), request.body)));
  context.api.post('/connections/:connectionId/pending/:id/deny', route(request => service.denyConnection(connectionId(request), String(request.params?.id || ''))));
  context.api.put('/connections/:connectionId/mappings/:id', route(request => service.updateConnectionMapping(connectionId(request), String(request.params?.id || ''), request.body)));
  context.api.delete('/connections/:connectionId/mappings/:id', route(request => service.deleteConnectionMapping(connectionId(request), String(request.params?.id || ''))));
  service.start().catch(() => context.logger.error('Switchboard startup failed'));

  context.logger.info('Burrow Switchboard activated');
  return async () => { await service.close(); context.logger.info('Burrow Switchboard stopped'); };
}

export { createSwitchboardService } from './connections.mjs';
