import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { connect, execute, type ManagedConnection } from '../../src/engine/connection';
import type { NetworkConnectionProfile } from '../../src/shared/contracts';
import { splitSql } from '../../src/engine/sql';
import { foreignKeyJoinReadOnlyCases } from '../helpers/foreignKeyJoinReadOnlyCases';

const enabled=process.env.DBARK_INTEGRATION_ENABLED==='1'&&process.env.DBARK_JOIN_ORDER_READONLY==='1';
describe.runIf(enabled)('JOIN排序只读派生表实库语义（不创建物理表）',()=>{
  it('准确实例的八条合成SELECT及关闭资源，不写库表或自动重试',async()=>{
    const env=process.env,host=env.DBARK_TEST_HOST??'',port=Number(env.DBARK_TEST_PORT);
    if(!['192.168.31.200','deve-server.yinzon.com'].includes(host)||![13357,13380,13384,13310,13311,13484].includes(port)||!env.DBARK_TEST_USER||!env.DBARK_TEST_EXPECTED_HOSTNAME||!env.DBARK_TEST_EXPECTED_VERSION)throw Error('JOIN排序只读专项缺少预核200实例身份');
    if(port===13484&&(env.DBARK_TEST_TLS!=='1'||!env.DBARK_TEST_CA))throw Error('13484必须严格TLS');
    const profile:NetworkConnectionProfile={id:randomUUID(),name:'JOIN只读派生表专项',dialect:'mysql',group:'合成SELECT',color:'#123456',host,port,user:env.DBARK_TEST_USER,password:env.DBARK_TEST_PASSWORD??'',...(port===13484?{tls:{enabled:true,rejectUnauthorized:true,caPath:env.DBARK_TEST_CA}}:{})};
    let managed:ManagedConnection|undefined,observer:ManagedConnection|undefined;
    try{
      managed=await connect(profile);const own=managed;
      const identity=(await execute<Record<string,unknown>[]>(own,'SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,VERSION() AS version')).rows[0];expect(identity.hostname).toBe(env.DBARK_TEST_EXPECTED_HOSTNAME);expect(String(identity.port)).toBe('3306');expect(identity.version).toBe(env.DBARK_TEST_EXPECTED_VERSION);expect(String(identity.serverId)).toBe(env.DBARK_TEST_EXPECTED_SERVER_ID);
      if(env.DBARK_TEST_EXPECTED_SERVER_UUID)expect((await execute<Record<string,unknown>[]>(own,'SELECT @@server_uuid AS uuid')).rows[0].uuid).toBe(env.DBARK_TEST_EXPECTED_SERVER_UUID);
      for(const test of foreignKeyJoinReadOnlyCases()){expect(test.sql.startsWith('SELECT\n')).toBe(true);expect(splitSql(test.sql)).toHaveLength(1);const actual=await execute<Record<string,unknown>[]>(own,test.sql);expect(actual.rows.map(row=>({...row})),test.name).toEqual(test.expected);}
      observer=await connect(profile);const thread=own.connection.threadId;await own.close();managed=undefined;expect((await execute<unknown[]>(observer,'SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?',[thread])).rows).toEqual([]);await observer.close();observer=undefined;
    }finally{if(managed)await managed.close();if(observer)await observer.close();}
  },60000);
});
