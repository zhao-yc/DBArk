import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { splitSql } from '../../src/engine/sql';
import { namedParameterTokens } from '../../src/shared/queryParameters';
import { foreignKeyJoinFilterReadOnlyCases } from '../helpers/foreignKeyJoinFilterReadOnlyCases';
import { tableInfo } from '../../src/engine/metadata';
import { buildForeignKeyJoin } from '../../src/renderer/tableForeignKeyJoin';

const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1'&&process.env.DBARK_JOIN_FILTER_READONLY==='1';
describe.runIf(enabled)('JOIN条件只读实库语义（测试本身不创建或修改表）',()=>{
  it('原模式及四种引号转义组合准确执行二十条SELECT，核警告和原连接收尾',async()=>{
    const env=process.env,host=env.DBARK_TEST_HOST??'',port=Number(env.DBARK_TEST_PORT);
    if(!['192.168.31.200','deve-server.yinzon.com'].includes(host)||![13357,13380,13384,13310,13311,13484].includes(port)||!env.DBARK_TEST_USER||!env.DBARK_TEST_EXPECTED_HOSTNAME||!env.DBARK_TEST_EXPECTED_VERSION)throw Error('JOIN条件只读专项缺少预核200实例身份');
    if(port===13484&&(env.DBARK_TEST_TLS!=='1'||!env.DBARK_TEST_CA))throw Error('13484必须严格TLS');
    const profile:NetworkConnectionProfile={id:randomUUID(),name:'JOIN条件只读专项',dialect:'mysql',group:'合成SELECT',color:'#123456',host,port,user:env.DBARK_TEST_USER,password:env.DBARK_TEST_PASSWORD??'',...(port===13484?{tls:{enabled:true,rejectUnauthorized:true,caPath:env.DBARK_TEST_CA}}:{})};
    let managed:ManagedConnection|undefined,observer:ManagedConnection|undefined;
    try{
      managed=await connect(profile);const own=managed,identity=(await execute<Record<string,unknown>[]>(own,'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,VERSION() AS version,@@session.sql_mode AS mode')).rows[0];
      expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME);expect(String(identity.port)).toBe('3306');expect(identity.version).toBe(env.DBARK_TEST_EXPECTED_VERSION);expect(String(identity.serverId)).toBe(env.DBARK_TEST_EXPECTED_SERVER_ID);
      if(env.DBARK_TEST_EXPECTED_SERVER_UUID)expect((await execute<Record<string,unknown>[]>(own,'SELECT @@server_uuid AS uuid')).rows[0].uuid).toBe(env.DBARK_TEST_EXPECTED_SERVER_UUID);
      const physical=env.DBARK_JOIN_FILTER_PHYSICAL==='1',database=env.DBARK_JOIN_FILTER_DATABASE??'',marker=env.DBARK_JOIN_FILTER_OWNER??'';
      const groups=env.DBARK_JOIN_GROUP_READONLY==='1';let cases=foreignKeyJoinFilterReadOnlyCases(groups);
      if(physical){
        // 仅消费已预置、准确owner的随机库；不在本测试创建/修改资源，也不关闭优化器。
        if(!/^dbark_joinfilter_[a-f0-9]{12}_(13357|13380|13384|13310|13311|13484)$/.test(database)||!database.endsWith('_'+port)||!/^dbark-joinfilter:[a-f0-9]{32}$/.test(marker))throw Error('准确JOIN物理夹具未绑定');
        expect((await execute<Record<string,unknown>[]>(own,'SELECT marker FROM `'+database+'`.__owner')).rows.map(row=>({...row}))).toEqual([{marker}]);
        const child=await tableInfo(own,database,'child'),parent=await tableInfo(own,database,'parent');expect(child.objectKind).toBe('table');expect(parent.objectKind).toBe('table');expect(child.foreignKeys).toMatchObject([{name:'fk',columns:['pid'],referencedDatabase:database,referencedTable:'parent',referencedColumns:['id']}]);
        cases=cases.map(test=>({...test,sql:buildForeignKeyJoin(child,parent,'fk','LEFT',43,test.options).sql}));
      }
      const modes=[String(identity.mode),'','ANSI_QUOTES','NO_BACKSLASH_ESCAPES','ANSI_QUOTES,NO_BACKSLASH_ESCAPES'];expect(cases).toHaveLength(groups?28:20);
      for(const mode of modes){
        // 只修改本例独占会话模式；不改全局、不写库表，失败直接关闭原会话，不自动重试。
        await execute(own,'SET SESSION sql_mode=?',[mode]);const actualMode=String((await execute<Record<string,unknown>[]>(own,'SELECT @@session.sql_mode AS mode')).rows[0].mode),tokens=new Set(actualMode.split(','));
        for(const flag of ['ANSI_QUOTES','NO_BACKSLASH_ESCAPES'])expect(tokens.has(flag)).toBe(mode.split(',').includes(flag));
        for(const test of cases){
          expect(splitSql(test.sql,tokens.has('NO_BACKSLASH_ESCAPES'),tokens.has('ANSI_QUOTES'))).toHaveLength(1);expect(namedParameterTokens(test.sql,{ansiQuotes:tokens.has('ANSI_QUOTES'),noBackslashEscapes:tokens.has('NO_BACKSLASH_ESCAPES')})).toEqual([]);
          try { expect((await execute<Record<string,unknown>[]>(own,test.sql)).rows.map(row=>({...row})),test.name).toEqual(test.expected);expect((await execute<unknown[]>(own,'SHOW WARNINGS LIMIT 1')).rows,test.name).toEqual([]); }
          catch(reason){const error=reason as {code?:string;sql?:string};console.info(JSON.stringify({failedCase:test.name,mode,thread:own.connection.threadId,code:error.code,actualSql:error.sql,derivedFixture:!physical}));throw reason;}
        }
      }
      observer=await connect(profile);const thread=own.connection.threadId;await own.close();managed=undefined;expect((await execute<unknown[]>(observer,'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?',[thread])).rows).toEqual([]);await observer.close();observer=undefined;
      console.info(JSON.stringify({port,cases:cases.length,modes:modes.length,selects:cases.length*modes.length,warningsChecked:true,originalThreadAbsent:true,globalChanges:0,schemaWrites:0,physicalForeignKeyVerified:physical}));
    }finally{if(managed)await managed.close();if(observer)await observer.close();}
  },60000);
});
