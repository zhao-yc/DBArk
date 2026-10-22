import { basename, dirname, isAbsolute, resolve } from 'node:path';

export const explainPropertiesSql = 'SELECT dbark_plan_value FROM (SELECT 2 AS dbark_plan_value UNION ALL SELECT 1) AS dbark_plan_source WHERE dbark_plan_value>=1 ORDER BY dbark_plan_value';

/** 实库窗口只接受本轮固定目标；配置一旦漂移，即使恢复也不再授予执行。 */
export function bindExplainPropertiesUi(read: () => { env: NodeJS.ProcessEnv; platform: string }) {
  const allowed = ['DBARK_INTEGRATION_ENABLED', 'DBARK_EXPLAIN_PROPERTIES_UI', 'DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_EXPLAIN_PROPERTIES_OUTPUT'];
  const snapshot = () => {
    const { env, platform } = read(), descriptors = Object.getOwnPropertyDescriptors(env);
    const keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^DBARK_|^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !('value' in descriptors[key]) || typeof descriptors[key].value !== 'string')) throw Error('执行计划原生配置无效');
    const value = (key: string) => descriptors[key]?.value as string;
    if (value('DBARK_INTEGRATION_ENABLED') !== '1' || value('DBARK_EXPLAIN_PROPERTIES_UI') !== '1' || value('DBARK_TEST_HOST') !== '192.168.31.200' || value('DBARK_TEST_PORT') !== '13384' || value('DBARK_TEST_TLS') !== '0' || !value('DBARK_TEST_USER').trim() || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value('DBARK_TEST_EXPECTED_SERVER_UUID'))) throw Error('执行计划实库目标无效');
    const output = value('DBARK_EXPLAIN_PROPERTIES_OUTPUT');
    if (!isAbsolute(output) || resolve(output) !== output || dirname(output) === output || !/^dbark-explain-properties-[a-f0-9]{32}$/.test(basename(output))) throw Error('执行计划缺少本轮独占输出');
    return { signature: JSON.stringify([platform, keys.map(key => [key, value(key)])]), target: { host: value('DBARK_TEST_HOST'), port: 13384 as const, user: value('DBARK_TEST_USER'), password: value('DBARK_TEST_PASSWORD'), uuid: value('DBARK_TEST_EXPECTED_SERVER_UUID'), output } };
  };
  const captured = snapshot(); let failed = false;
  return { target: Object.freeze(captured.target), assertCurrent() { if (failed) throw Error('执行计划原配置已停链'); try { if (snapshot().signature !== captured.signature) throw Error('执行计划原配置已变化'); } catch (error) { failed = true; throw error; } } };
}

/** 序列化到真实 Main 的单次只读计划审计；任何违规请求均在原处理器之前停链。 */
export function installExplainPropertiesAudit({ ipcMain }: { ipcMain: any }, target: { senderId: number; profileId: string; tabId: string; sql: string }): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request');
  const captured = { senderId: target.senderId, profileId: target.profileId, tabId: target.tabId, sql: target.sql };
  if (root.__dbarkExplainPropertiesAudit || typeof original !== 'function' || !Number.isSafeInteger(captured.senderId) || captured.senderId <= 0 || !captured.profileId || !captured.tabId || captured.sql !== 'SELECT dbark_plan_value FROM (SELECT 2 AS dbark_plan_value UNION ALL SELECT 1) AS dbark_plan_source WHERE dbark_plan_value>=1 ORDER BY dbark_plan_value') throw Error('执行计划审计归属无效');
  const state: any = { explains: 0, sessions: 0, pending: 0, sessionId: undefined, failed: false, check: undefined };
  const reject = (): never => { state.failed = true; throw Error('执行计划原生审计停链'); };
  const same = (value: any, fields: string[]) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => fields.includes(key));
  state.check = () => { if (state.failed || root.__dbarkExplainPropertiesAudit !== state || handlers.get('dbark:request') !== wrapped || Object.keys(captured).some(key => (captured as any)[key] !== (target as any)[key])) reject(); };
  const wrapped = async (event: any, payload: any) => {
    if (event.sender?.id !== captured.senderId) return original(event, payload);
    state.check(); const command = payload?.command, input = payload?.input;
    if (command === 'settings.save') {
      const tabs = input?.tabs, tab = tabs?.[0];
      if (!Array.isArray(tabs) || tabs.length !== 1 || input.activeTabId !== captured.tabId || tab?.id !== captured.tabId || tab.kind !== 'query' || tab.connectionId !== captured.profileId || tab.sql !== captured.sql) reject();
    } else if (command === 'connections.open') { if (!same(input, ['id']) || input.id !== captured.profileId) reject(); }
    else if (command === 'sessions.open') {
      if (!same(input, ['connectionId', 'database']) || input.connectionId !== captured.profileId || (input.database !== undefined && input.database !== null) || state.sessions) reject();
      state.sessions++;
    } else if (command === 'query.explain') {
      if (!same(input, ['sessionId', 'sql', 'taskId', 'maxRows', 'format']) || !state.sessionId || input.sessionId !== state.sessionId || input.sql !== captured.sql || input.format !== 'auto' || typeof input.taskId !== 'string' || !input.taskId || !Number.isSafeInteger(input.maxRows) || input.maxRows < 1 || input.maxRows > 100000 || state.explains) reject();
      state.explains++;
    } else if (command === 'query.completionState' || command === 'sessions.close') { if (!same(input, ['sessionId']) || !state.sessionId || input.sessionId !== state.sessionId) reject(); }
    else if (command === 'metadata.completion') { if (!input || input.connectionId !== captured.profileId) reject(); }
    else if (!['connections.list', 'settings.get', 'history.list', 'tasks.list'].includes(command)) reject();
    state.pending++;
    try {
      const response = await original(event, payload); state.check(); if (response?.ok !== true) reject();
      if (command === 'connections.open' && (response.result?.dialect !== 'mysql' || response.result.version !== '8.4.11')) reject();
      if (command === 'sessions.open') { if (state.sessions !== 1 || state.sessionId || typeof response.result?.sessionId !== 'string' || !response.result.sessionId) reject(); state.sessionId = response.result.sessionId; }
      if (command === 'query.explain' && (response.result?.explain?.format !== 'json' || !Array.isArray(response.result.explain.nodes) || !response.result.explain.nodes.length)) reject();
      return response;
    } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  root.__dbarkExplainPropertiesAudit = state; handlers.set('dbark:request', wrapped); state.check();
}

/** 只读执行计数，不输出 SQL、会话标识或认证信息。 */
export function readExplainPropertiesAudit(): { explains: number; sessions: number; pending: number } {
  const state = (globalThis as any).__dbarkExplainPropertiesAudit;
  if (!state || typeof state.check !== 'function') throw Error('执行计划原生审计缺失'); state.check();
  return { explains: state.explains, sessions: state.sessions, pending: state.pending };
}
