/** 仅供本地补全分析使用；缺省能力不代表服务器支持，不属于共享IPC或执行授权。 */
export interface CompletionScopeCapabilities{lateralDerivedTables?:boolean;windowFunctions?:boolean;insertRowAliases?:boolean}

/** 调用方须先核验服务器家族；这里只筛MySQL8版本，mysql分类本身不能认证兼容厂商。 */
export function completionCapabilitiesForServer(dialect:unknown,serverVersion:unknown):CompletionScopeCapabilities{
  const disabled={lateralDerivedTables:false,windowFunctions:false,insertRowAliases:false};
  if(typeof serverVersion!=='string'||serverVersion.length>128)return disabled;
  if(dialect==='mysql'){
    const version=/^8\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})(?:-(?:log|commercial|debug))?$/.exec(serverVersion);
    // VALUES 新行别名从 MySQL 8.0.19 起支持，仍沿用已认可的版本及厂商格式。
    return{lateralDerivedTables:!!version&&(Number(version[1])>0||Number(version[2])>=14),windowFunctions:!!version&&(Number(version[1])>0||Number(version[2])>=2),insertRowAliases:!!version&&(Number(version[1])>0||Number(version[2])>=19)};
  }
  // 仅已核验MariaDB家族的10.2+/11.x；兼容前缀可去掉，未知厂商/主版本继续关闭。
  const maria=dialect==='mariadb'?/^(?:5\.5\.5-)?(10|11)\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})(?:-MariaDB(?:[-+~.0-9A-Za-z_]*)?)?$/.exec(serverVersion):null;
  return{lateralDerivedTables:false,windowFunctions:!!maria&&(maria[1]==='11'||Number(maria[2])>=2),insertRowAliases:false};
}
