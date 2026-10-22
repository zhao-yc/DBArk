import { win32 } from 'node:path';

export const savedQueryOrganizationNativeGate = 'DBARK_QUERY_ORGANIZATION_NATIVE_TEST';
/** 独立离线五键门；默认/列表不加载桌面，不读取凭据，不借用其它专项开关。 */
export function bindSavedQueryOrganizationNative(read: () => { env: NodeJS.ProcessEnv; args: readonly string[]; platform: string }) {
  const allowed = [savedQueryOrganizationNativeGate, 'DBARK_INTEGRATION_ENABLED', 'DBARK_QUERY_ORGANIZATION_OUTPUT', 'DBARK_QUERY_ORGANIZATION_MANIFEST', 'DBARK_QUERY_ORGANIZATION_MANIFEST_SHA256'];
  const capture = () => {
    const { env, args, platform } = read(), descriptors = Object.getOwnPropertyDescriptors(env), keys = Reflect.ownKeys(descriptors).filter((key): key is string => typeof key === 'string' && /^(?:DBARK_|NODE_OPTIONS$|NODE_PATH$|ELECTRON_RUN_AS_NODE$)/i.test(key)).sort();
    if (platform !== 'win32' || keys.length !== allowed.length || keys.some(key => !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value') || typeof descriptors[key].value !== 'string')) throw Error('保存查询分组离线配置无效');
    const value = (key: string) => descriptors[key].value as string, output = value('DBARK_QUERY_ORGANIZATION_OUTPUT'), manifest = value('DBARK_QUERY_ORGANIZATION_MANIFEST'), sha = value('DBARK_QUERY_ORGANIZATION_MANIFEST_SHA256');
    if (value(savedQueryOrganizationNativeGate) !== '1' || value('DBARK_INTEGRATION_ENABLED') !== '0' || !win32.isAbsolute(output) || win32.resolve(output) !== output || !/^dbark-query-organization-[a-f0-9]{32}$/.test(win32.basename(output)) || !win32.isAbsolute(manifest) || win32.resolve(manifest) !== manifest || !/^[a-f0-9]{64}$/.test(sha)) throw Error('保存查询分组缺少独占输出或批准身份');
    for (const [index, argument] of args.entries()) if (argument === '--config' || argument === '-c' || argument.startsWith('--config=') || /^-c./.test(argument) || ['--ui', '--debug', '--repeat-each', '--retries', '--workers'].includes(argument) || /^--(?:repeat-each|retries|workers)=/.test(argument) || argument === '--trace' && args[index + 1] !== 'off' || argument.startsWith('--trace=') && argument !== '--trace=off') throw Error('保存查询分组拒绝运行器覆盖');
    return { signature: JSON.stringify([platform, args, keys.map(key => [key, value(key)])]), output, manifest, sha };
  };
  const original = capture(); let retained = false;
  return { target: Object.freeze({ output: original.output, manifest: original.manifest, sha: original.sha }), assertCurrent() { if (retained) throw Error('保存查询分组离线门已停链'); try { if (capture().signature !== original.signature) throw Error('保存查询分组配置已变化'); } catch (error) { retained = true; throw error; } } };
}

/** 数据全部为合成资料；危险SQL只作为保存正文，绝不执行。 */
export function savedQueryOrganizationFixture(index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= 58) throw Error('合成资料编号无效');
  return { id: 'organization-' + String(index).padStart(2, '0'), name: '资料' + String(index).padStart(2, '0'), sql: '-- 仅保存不执行\r\nSELECT ' + index + ' AS 原值;' + (index === 33 ? ' /*' + 'x'.repeat(8000) + '全文尾部组织标记*/' : '') };
}

/** 序列化到原Main审计真实IPC；只允许本地资料操作，用户SQL与数据库会话请求直接拒绝。 */
export function installSavedQueryOrganizationAudit({ ipcMain, BrowserWindow }: { ipcMain: any; BrowserWindow: any }, target: { senderId: number; profileId: string }) {
  const root = globalThis as any, handlers = ipcMain._invokeHandlers, original = handlers?.get('dbark:request'), window = BrowserWindow.getAllWindows().find((item: any) => item.webContents.id === target.senderId), sender = window?.webContents, frame = sender?.mainFrame;
  if (root.__savedQueryOrganizationAudit || typeof original !== 'function' || !sender || !frame || frame.detached || !target.profileId) throw Error('保存查询分组Main归属不明');
  const frameProcess = frame.processId, frameToken = frame.frameToken, url = frame.url, operations: string[] = [], counts = new Map<string, number>(), state: any = { pending: 0, failed: false, quitting: false };
  const allowed = new Set(['queries.organizationGet', 'queries.organizationApply', 'queries.page', 'queries.pageContinue', 'queries.pageRelease', 'queries.read', 'queries.updateSource', 'queries.list', 'history.page', 'history.pageContinue', 'history.pageRelease', 'history.list', 'tasks.list', 'settings.get', 'settings.save', 'connections.list', 'workbench.get', 'app.info', 'security.encryptionAvailable', 'app.setDirty', 'query.cancel', 'metadata.completion']);
  const reject = (): never => { state.failed = true; throw Error('保存查询分组Main出现非本例本地操作'); };
  const check = () => { if (state.failed || root.__savedQueryOrganizationAudit !== state || handlers.get('dbark:request') !== wrapped || !state.quitting && (sender.isDestroyed() || sender.mainFrame !== frame || frame.detached || frame.processId !== frameProcess || frame.frameToken !== frameToken || frame.url !== url)) reject(); };
  const wrapped = async (event: any, payload: any) => {
    check(); const command = payload?.command, input = payload?.input;
    if (event.sender !== sender || event.senderFrame !== frame || !allowed.has(command)) reject();
    if (command === 'metadata.completion' && input?.connectionId !== target.profileId || command === 'queries.updateSource' && input?.source?.id !== 'organization-33') reject();
    counts.set(command, (counts.get(command) ?? 0) + 1); if (command === 'queries.organizationApply') operations.push(input?.operation?.kind);
    if (operations.length > 20 || [...counts.values()].reduce((a, b) => a + b, 0) > 2000) reject();
    state.pending++;
    try { const response = await original(event, payload); check(); return response; } catch (error) { state.failed = true; throw error; } finally { state.pending--; }
  };
  Object.assign(state, { check, counts, operations }); root.__savedQueryOrganizationAudit = state; handlers.set('dbark:request', wrapped); check();
}
/** 报告不包含SQL、路径、查询名称或认证，只返回正式命令计数。 */
export function readSavedQueryOrganizationAudit() { const state = (globalThis as any).__savedQueryOrganizationAudit; if (!state) throw Error('分组审计缺失'); state.check(); return { pending: state.pending, commands: Object.fromEntries(state.counts), operations: [...state.operations] }; }
/** 退出仅允许原Main收尾保存；原进程正常退出及归属由已有运行器另核。 */
export function quitSavedQueryOrganizationAudit() { const state = (globalThis as any).__savedQueryOrganizationAudit; state.check(); if (state.pending) throw Error('分组本地请求未结束'); state.quitting = true; }
