/** 只验证调用方显式 RAM 参数；不加载 .env、不读凭据文件，也不把环境内容写入错误。 */
export function insertRowAliasUiTarget(env:Readonly<Record<string,string|undefined>>){
  if(env.DBARK_INTEGRATION_ENABLED!=='1'||env.DBARK_INSERT_ROW_ALIAS_UI!=='1')throw Error('UPSERT真实UI须显式双门开启');
  if(env.DBARK_TEST_HOST!=='192.168.31.200'||env.DBARK_TEST_PORT!=='13384'||env.DBARK_TEST_TLS!==undefined&&env.DBARK_TEST_TLS!=='0')throw Error('UPSERT真实UI仅接Root核对的200明文13384实例');
  if(!/^dbark_upsert_[a-f0-9]{32}$/.test(env.DBARK_TEST_DATABASE??''))throw Error('须Root预建本例专属随机库');
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.DBARK_TEST_EXPECTED_SERVER_UUID??''))throw Error('须Root先核实际服务器UUID并显式绑定');
  if(!env.DBARK_TEST_USER||env.DBARK_TEST_PASSWORD===undefined)throw Error('须Root显式注入RAM测试账号，不读取凭据回退');
  if(env.DBARK_SNIPPETS_NATIVE_DIAGNOSTICS==='1')throw Error('本片不启用原生诊断采集');
  return Object.freeze({host:env.DBARK_TEST_HOST,port:13384,database:env.DBARK_TEST_DATABASE!,uuid:env.DBARK_TEST_EXPECTED_SERVER_UUID!,user:env.DBARK_TEST_USER,password:env.DBARK_TEST_PASSWORD});
}
