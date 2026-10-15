/** 原生应用只继承必要桌面环境，不把 ROOT 管理口令、CA key 口令或通用实库凭据带入子进程。 */
export function c02DesktopEnvironment(source: NodeJS.ProcessEnv, dataDir: string): Record<string, string> {
  const env: Record<string, string> = { DBARK_USER_DATA: dataDir };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'SystemDrive', 'WINDIR', 'ComSpec', 'PATH', 'Path', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USER', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL']) if (source[key] !== undefined) env[key] = source[key]!;
  return env;
}

/** 只允许已知的本例关闭确认；保存失败时取消退出并标记失败，不能悄悄放弃配置来冒充持久化通过。 */
export function c02DialogAnswer(buttons: string[], message: string): { response: number; unexpected: boolean } {
  if (message === '退出会放弃尚未提交的表格修改、断开数据库连接并回滚未提交事务。已提交的操作不会撤销。' && buttons.includes('退出客户端')) return { response: buttons.indexOf('退出客户端'), unexpected: false };
  if (/^此标签有待提交修改或活动事务。|^关闭查询标签？/.test(message) && buttons.length === 2) return { response: 0, unexpected: false };
  return { response: 0, unexpected: true };
}

/** 只有 ESRCH 才证明进程已消失；EPERM/其它读取错误保守视为仍存在，不能形成全零伪证。 */
export function c02PidGone(pid: number, probe: (pid: number) => unknown = value => process.kill(value, 0)): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { probe(pid); return false; } catch (error) { return (error as NodeJS.ErrnoException | undefined)?.code === 'ESRCH'; }
}
