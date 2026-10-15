import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {connect,execute,type ManagedConnection} from '../../src/engine/connection';
import {databaseSearchMatch} from '../../src/engine/databaseSearchMatch';
import type {DatabaseSearchMode} from '../../src/shared/databaseSearchPattern';
import type {ConnectionProfile} from '../../src/shared/contracts';

const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1';
const profile:ConnectionProfile={id:randomUUID(),name:'全库搜索匹配规则验收',group:'',color:'#123456',dialect:'mysql',host:process.env.DBARK_TEST_HOST??'',port:Number(process.env.DBARK_TEST_PORT??13384),user:process.env.DBARK_TEST_USER??'',password:process.env.DBARK_TEST_PASSWORD,...(process.env.DBARK_TEST_TLS==='1'?{tls:{enabled:true,rejectUnauthorized:true,caPath:process.env.DBARK_TEST_CA}}:{})};
let managed:ManagedConnection|undefined,observer:ManagedConnection|undefined,threadId:number|undefined;

/** 固定派生单行与预处理参数检验真实服务器，不创建库表/用户/授权，也不使用业务数据。 */
async function matched(value:string|null,text:string,mode:DatabaseSearchMode,caseSensitive=false,representation:'text'|'hex'='text'){
  const predicate=databaseSearchMatch({column:'value',qualifier:'sample',representation},{mode,text,caseSensitive});
  const result=await execute<Record<string,unknown>[]>(managed!,'SELECT ('+predicate.sql+') AS matched FROM (SELECT ? AS `value`) AS sample',[...predicate.params,value]);return result.rows[0].matched===null?null:Number(result.rows[0].matched);
}

describe.skipIf(!enabled)('200隔离实例：全库搜索匹配规则',()=>{
  beforeAll(async()=>{if(profile.host!=='192.168.31.200'||![13357,13380,13384,13310,13311,13484].includes(profile.port))throw Error('仅允许已核实200隔离实例');observer=await connect(profile);managed=await connect(profile);threadId=managed.connection.threadId;if(!Number.isSafeInteger(threadId)||threadId!<1)throw Error('未取得真实驱动会话编号');},30000);
  afterAll(async()=>{try{await managed?.close({strict:true});if(observer&&threadId){expect((await execute<Record<string,unknown>[]>(observer,'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?',[threadId])).rows).toHaveLength(0);console.log(JSON.stringify({验收说明:'搜索匹配驱动逐ID释放',连接数量:1,残留数量:0}));}}finally{await observer?.close({strict:true});}},30000);
  it('包含和前缀按文字对待百分号、下划线、转义符与反斜线',async()=>{
    for(const mode of['contains','prefix'] as const){expect(await matched('a!%_\\tail','a!%_\\',mode)).toBe(1);expect(await matched('abc','a%',mode)).toBe(0);expect(await matched('aXb','a_b',mode)).toBe(0);}
    expect(await matched('前缀🚀后缀','🚀','contains')).toBe(1);expect(await matched('前缀🚀后缀','🚀','prefix')).toBe(0);
  });
  it('大小写显式控制而不把重音差别或尾空格当作相同完整值',async()=>{
    for(const mode of['contains','whole','prefix'] as const){expect(await matched('CAFÉ','café',mode,false)).toBe(1);expect(await matched('CAFÉ','café',mode,true)).toBe(0);}
    expect(await matched('café','cafe','whole',false)).toBe(0);expect(await matched('value ','value','whole')).toBe(0);expect(await matched('value ','value ','whole')).toBe(1);
  });
  it('完整空字符串与NULL分开，精确数字和NUL原文不经JS数值或JSON转换',async()=>{
    expect(await matched('','','whole')).toBe(1);expect(await matched(null,'','whole')).toBeNull();
    for(const value of['9007199254740993','12345678901234567890.123456789012','a\0B','x\' OR 1=1 --']){expect(await matched(value,value,'whole',true)).toBe(1);expect(await matched('另一原文',value,'whole',true)).toBe(0);}
  });
  it('实际数值和微秒字段由服务器转文本保持精度',async()=>{
    for(const[cast,text]of[["CAST('9007199254740993' AS UNSIGNED)",'9007199254740993'],["CAST('12345678901234567890.123456789012' AS DECIMAL(40,12))",'12345678901234567890.123456789012'],["CAST('2026-10-15 12:34:56.123456' AS DATETIME(6))",'2026-10-15 12:34:56.123456']]){const predicate=databaseSearchMatch({column:'value'},{mode:'whole',text,caseSensitive:true});const result=await execute<Record<string,unknown>[]>(managed!,'SELECT ('+predicate.sql+') AS matched FROM (SELECT '+cast+' AS `value`) AS sample',predicate.params);expect(Number(result.rows[0].matched)).toBe(1);}
  });
  it('正则交由当前服务器执行，显式排序规则兼容MySQL8非二进制要求',async()=>{
    expect(await matched('ABC','^abc$','regexp',false)).toBe(1);expect(await matched('ABC','^abc$','regexp',true)).toBe(0);expect(await matched('abc-123','^[a-z]+-[0-9]+$','regexp',true)).toBe(1);expect(await matched(null,'a','regexp')).toBeNull();
    await expect(matched('abc','[','regexp')).rejects.toThrow();expect(Number((await execute<Record<string,unknown>[]>(managed!,'SELECT 1 AS alive')).rows[0].alive)).toBe(1);
  });
  it('预处理不依赖ANSI_QUOTES/NBE，名称内的点号与反引号按单段引用',async()=>{
    for(const mode of['','ANSI_QUOTES,NO_BACKSLASH_ESCAPES']){await execute(managed!,"SET SESSION sql_mode='"+mode+"'");expect(await matched('a\\b','a\\b','whole',true)).toBe(1);expect(await matched('a\\b','a\\','prefix',true)).toBe(1);const predicate=databaseSearchMatch({column:'a`.b',qualifier:'sample'},{mode:'whole',text:'原文🚀',caseSensitive:true});const result=await execute<Record<string,unknown>[]>(managed!,'SELECT ('+predicate.sql+') AS matched FROM (SELECT ? AS `a``.b`) AS sample',[...predicate.params,'原文🚀']);expect(Number(result.rows[0].matched)).toBe(1);}
  });
  it('HEX明确为十六进制文本匹配，不强制把二进制内容解码为UTF8',async()=>{expect(await matched('\0A','0041','whole',false,'hex')).toBe(1);expect(await matched('A','41','prefix',false,'hex')).toBe(1);});
});
