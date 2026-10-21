import { basename, dirname, isAbsolute, resolve } from 'node:path';

/** 独立离线窗口只绑定本轮输出，不读取任何数据库认证；配置漂移永久撤销。 */
export function bindConnectionOrganizationUi(read: () => { env: NodeJS.ProcessEnv; platform: string }) {
  const snapshot = () => { const { env, platform } = read(); const keys = Object.keys(env).filter(key => /^DBARK_|^(?:NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/i.test(key)).sort();
    if (platform !== 'win32' || env.DBARK_CONNECTION_ORGANIZATION_UI !== '1' || keys.some(key => !['DBARK_CONNECTION_ORGANIZATION_UI', 'DBARK_CONNECTION_ORGANIZATION_OUTPUT'].includes(key))) throw Error('连接整理离线窗口配置无效');
    const output = env.DBARK_CONNECTION_ORGANIZATION_OUTPUT;
    if (!output || !isAbsolute(output) || resolve(output) !== output || dirname(output) === output || !/^dbark-connection-organization-[a-f0-9]{32}$/.test(basename(output))) throw Error('连接整理缺少本轮独占输出');
    return JSON.stringify([platform, keys.map(key => [key, env[key]])]); };
  const signature = snapshot(), output = read().env.DBARK_CONNECTION_ORGANIZATION_OUTPUT!; let failed = false;
  return { output, assertCurrent() { if (failed) throw Error('连接整理原配置已停链'); try { if (snapshot() !== signature) throw Error('连接整理原配置已变化'); } catch (error) { failed = true; throw error; } } };
}

/** 仅序列化到本例Main：三次空认证新建和一次外观批次；未知请求在原处理器前拒绝。 */
export function installConnectionOrganizationAudit({ ipcMain }: { ipcMain: any }, senderId: number): void {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request');
  if (root.__dbarkConnectionOrganizationAudit || !Number.isSafeInteger(senderId) || senderId <= 0 || typeof original !== 'function') throw Error('连接整理审计归属无效');
  const state: any = { saved: 0, gets: 0, applied: 0, pending: 0, ids: [], failed: false, check: undefined };
  const reject = () => { state.failed = true; throw Error('连接整理离线审计停链'); };
  state.check = () => { if (state.failed || root.__dbarkConnectionOrganizationAudit !== state || handlers.get('dbark:request') !== wrapped) reject(); };
  const wrapped = async (event: any, payload: any) => {
    if (event.sender?.id !== senderId) return original(event, payload);
    state.check(); const command = payload?.command, input = payload?.input;
    if (command === 'connections.save') {
      if (state.saved >= 3 || state.applied || !input || !['整理甲', '整理乙', '整理丙'].includes(input.name) || input.host !== '127.0.0.1' || input.port !== 3306 || input.user !== 'dbark_synthetic' || input.dialect !== 'mysql' || input.rememberPassword !== false || input.password || input.ssh?.enabled || input.tls?.enabled || state.ids.includes(input.id)) reject();
      state.saved++; state.ids.push(input.id);
    } else if (command === 'connections.organizationGet') { if (state.saved !== 3 || state.gets >= 2) reject(); state.gets++; }
    else if (command === 'connections.organizationApply') {
      if (state.saved !== 3 || state.gets !== 1 || state.applied || input.expectedRevision !== 3 || !Array.isArray(input.ids) || input.ids.length !== 3 || new Set(input.ids).size !== 3 || input.ids.some((id: string) => !state.ids.includes(id)) || JSON.stringify(input.changes) !== JSON.stringify({ group: '本轮批量组', color: '#123456' })) reject();
      state.applied++;
    } else if (command === 'settings.save') { if (input.tabs?.length !== 0) reject(); }
    else if (!['connections.list', 'settings.get', 'tasks.list', 'workbench.get'].includes(command)) reject();
    state.pending++;
    try { const response = await original(event, payload); state.check(); if (response?.ok !== true) reject(); return response; }
    catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  root.__dbarkConnectionOrganizationAudit = state; handlers.set('dbark:request', wrapped); state.check();
}
/** 只取计数，不记录连接正文、ID或文件内容。 */
export function readConnectionOrganizationAudit(): { saved: number; gets: number; applied: number; pending: number } {
  const state = (globalThis as any).__dbarkConnectionOrganizationAudit;
  if (!state || typeof state.check !== 'function') throw Error('连接整理审计缺失'); state.check();
  return { saved: state.saved, gets: state.gets, applied: state.applied, pending: state.pending };
}
