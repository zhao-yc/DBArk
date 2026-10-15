/** 仅供本地补全分析使用；缺省能力不代表服务器支持，不属于共享IPC或执行授权。 */
export interface CompletionScopeCapabilities{lateralDerivedTables?:boolean}

/** 调用方须先核验服务器家族；这里只筛MySQL8版本，mysql分类本身不能认证兼容厂商。 */
export function completionCapabilitiesForServer(dialect:unknown,serverVersion:unknown):CompletionScopeCapabilities{
  if(dialect!=='mysql'||typeof serverVersion!=='string'||serverVersion.length>128)return{lateralDerivedTables:false};
  const version=/^8\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})(?:-(?:log|commercial|debug))?$/.exec(serverVersion);
  return{lateralDerivedTables:!!version&&(Number(version[1])>0||Number(version[2])>=14)};
}
