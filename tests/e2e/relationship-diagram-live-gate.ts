export interface RelationshipLiveEnvironment {
  host: string; port: 13384; user: string; password: string;
  source: string; target: string; owner: string; serverUuid: string;
}

/** Main只接受这组声明动作；目标和参数仍在原处理器前逐项核对，未声明的新命令默认拒绝。 */
export const relationshipLiveCommands: readonly string[] = Object.freeze([
  'app.menuState', 'app.runtimeInfo', 'app.info', 'app.setDirty', 'settings.get', 'settings.save',
  'connections.list', 'connections.organizationGet', 'connections.save', 'connections.open', 'connections.close',
  'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake',
  'metadata.table', 'metadata.objects', 'table.page', 'table.preferences.get', 'query.cancel', 'tasks.list', 'history.list',
]);

/** 只允许显式实库轮及同一随机命名空间；本模块不读文件、不连接网络、不创建资源。 */
export function relationshipLiveEnvironment(env: Record<string, string | undefined>, args: readonly string[], platform: string): Readonly<RelationshipLiveEnvironment> {
  const fail = (): never => { throw Error('关系图实库门不完整或目标越界；需要13384专用实例、同一随机两库、owner和准确服务器UUID。'); };
  if (!Array.isArray(args as unknown) || env.DBARK_ER_LIVE_NATIVE !== '1' || env.DBARK_INTEGRATION_ENABLED !== '1' || !['win32', 'darwin'].includes(platform)) return fail();
  if (['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'PWDEBUG', 'DBARK_EXECUTABLE_PATH', 'DBARK_DEV_URL', 'DBARK_USER_DATA', 'SSH_AUTH_SOCK', 'SSH_AGENT_PID'].some(key => env[key] !== undefined) || Object.keys(env).some(key => /^DBARK_(?:SSH_|MTLS_)/.test(key))) return fail();
  const host = env.DBARK_TEST_HOST, user = env.DBARK_TEST_USER, password = env.DBARK_TEST_PASSWORD, source = env.DBARK_ER_SOURCE_DATABASE, target = env.DBARK_ER_TARGET_DATABASE, owner = env.DBARK_ER_OWNER, serverUuid = env.DBARK_ER_SERVER_UUID;
  if (!host || !['192.168.31.200', 'deve-server.yinzon.com'].includes(host) || env.DBARK_TEST_PORT !== '13384' || !user || !password || !source || !/^dbark_ergraph_[a-f0-9]{12}_a$/.test(source) || target !== source.slice(0, -1) + 'b' || !owner || !/^[a-f0-9]{32}$/.test(owner) || !serverUuid || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(serverUuid)) return fail();
  if (env.DBARK_TEST_DATABASE !== undefined && env.DBARK_TEST_DATABASE !== source) return fail();
  // 原生门槛不能由命令行覆盖；不接受其它配置/项目或重复执行原资源。
  const fixed = new Map([['--workers', '1'], ['--retries', '0'], ['--repeat-each', '1'], ['--trace', 'off'], ['--timeout', '120000']]);
  for (let i = 0; i < args.length; i++) {
    const argument = args[i]; if (/^--(?:config|project)(?:=|$)|^-c/.test(argument)) return fail();
    const at = argument.indexOf('='), name = at < 0 ? argument : argument.slice(0, at);
    if (fixed.has(name)) { const value = at < 0 ? args[++i] : argument.slice(at + 1); if (value !== fixed.get(name)) return fail(); }
  }
  return Object.freeze({ host, port: 13384, user, password, source, target, owner, serverUuid });
}
