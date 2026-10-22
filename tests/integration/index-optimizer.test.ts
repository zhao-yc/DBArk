import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { EngineCommand, TaskEvent } from '../../src/shared/contracts';
import type { TableIndexApplyOutput, TableIndexGetOutput, TableIndexPreviewOutput } from '../../src/shared/tableIndexTasks';
import { bindIndexOptimizerTarget, indexOptimizerIntegrationGate, indexOptimizerLifetime, loadIndexOptimizerModules, assertIndexOptimizerIdentity, watchIndexOptimizerConnection, assertIndexOptimizerReleased, closeIndexOptimizerObserver, type IndexOptimizerConnectionFact, type IndexOptimizerLifetime } from '../helpers/indexOptimizerIntegration';

const audit = vi.hoisted(() => ({ watch: undefined as undefined | ((managed: ManagedConnection, scope: string) => void), check: undefined as undefined | (() => void), scope: '' }));
/** 只旁观原connect、原Query回调和原物理流，真实Engine及目录/计划/状态机全部透传。 */
vi.mock('../../src/engine/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/engine/connection')>();
  return { ...actual, connect: async (...args: Parameters<typeof actual.connect>) => {
    if (!audit.watch || !audit.check || !audit.scope) throw Error('索引优化器连接缺少本轮owner');
    audit.check(); const scope = audit.scope, managed = await actual.connect(...args); audit.watch(managed, scope); return managed;
  } };
});

let lifetime: IndexOptimizerLifetime | undefined, retained = false, complete = false;
afterEach(() => { if (lifetime && !complete) { retained = true; lifetime.stop(); } lifetime?.end(); });

describe.sequential('索引优化器属性六实例实库（逐端口独立进程）', () => {
  it('普通/唯一/复合键原生往返、恢复旧隐藏键、真实聚簇保护、FK/自增/精度及资源闭环', { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env[indexOptimizerIntegrationGate] !== '1') { context.skip(); return; }
    if (retained) throw Error('索引优化器原验收仍保留现场，禁止自动重跑');
    const binding = bindIndexOptimizerTarget(() => process.env, 'iopt-' + context.task.id), owner = lifetime = indexOptimizerLifetime(context, binding, () => { retained = true; });
    const facts: IndexOptimizerConnectionFact[] = [], events: TaskEvent[] = []; let allowedSql: string | undefined;
    audit.check = owner.check; audit.watch = (managed, scope) => { facts.push(watchIndexOptimizerConnection(managed, scope, owner, () => allowedSql)); };
    let observer: ManagedConnection | undefined, engine: import('../../src/engine/index').Engine | undefined;
    let database = '', marker = '', created: 'absent' | 'unknown' | 'confirmed' = 'absent';
    try {
      const { engine: module, connection } = await owner.step(loadIndexOptimizerModules), quote = await owner.step(() => import('../../src/engine/sql')), crypto = await owner.step(() => import('node:crypto'));
      database = 'dbark_e2e_iopt_' + crypto.randomUUID().replaceAll('-', ''); marker = 'dbark-index-optimizer:' + crypto.randomUUID();
      if (!/^dbark_e2e_iopt_[a-f0-9]{32}$/.test(database)) throw Error('索引优化器随机资源计划无效');
      process.stdout.write(JSON.stringify({ 专项:'索引优化器',阶段:'原资源计划',端口:binding.profile.port,数据库:database,所有者标记:marker })+'\n');
      const db = quote.identifier(database), table = (name: string) => db + '.' + quote.identifier(name);
      /** 原observer顺序执行，每次先核owner；任何未知终态后不另建连接清理。 */
      const sql = async <T = Record<string, unknown>[]>(text: string, values: (string | number | boolean | null | Buffer)[] = []) => {
        audit.scope = 'observer'; return (await owner.step(() => connection.execute<T>(observer!, text, values))).rows;
      };
      const rejectsSql = async (text: string, errno: number) => {
        audit.scope = 'observer'; const result = await owner.step(async () => { try { await connection.execute(observer!, text); return { error: undefined }; } catch (error) { return { error }; } });
        expect(result.error).toMatchObject({ errno });
      };
      audit.scope = 'observer'; observer = await owner.step(() => connection.connect(binding.profile));
      const identity = await sql('SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames'), uuid = binding.dialect === 'mysql' ? await sql('SELECT @@server_uuid AS uuid') : undefined;
      assertIndexOptimizerIdentity(identity, binding, observer.status, uuid);
      engine = new module.Engine(event => events.push(event));
      /** 捕获返回错误但不吞意外异常；只有原managed/原生流终态全部证明后才继续。 */
      const invoke = async <T>(command: EngineCommand, input: Record<string, unknown>, expectedSql?: string) => {
        const scope = crypto.randomUUID(); audit.scope = scope; allowedSql = expectedSql; const start = facts.length;
        const result = await owner.step(async () => { try { return { value: await engine!.handle(command, input) as T }; } catch (error) { return { error }; } });
        const actual = facts.slice(start); for (const fact of actual) await owner.step(() => fact.closed);
        assertIndexOptimizerReleased(actual, command.startsWith('schema.')); allowedSql = undefined; return { ...result, facts: actual };
      };
      const opened = await invoke('connections.open', {id:binding.profile.id,profile:binding.profile}); expect(opened.error).toBeUndefined(); expect(opened.facts).toHaveLength(1);
      expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?',[database])).toHaveLength(0);
      created='unknown'; expect((await sql<{warningStatus:number}>(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`)).warningStatus).toBe(0); created='confirmed';
      await sql(`CREATE TABLE ${table('subject')}(id BIGINT UNSIGNED NOT NULL,a BIGINT NOT NULL,amount DECIMAL(30,6) NOT NULL,payload VARBINARY(8),PRIMARY KEY(id),UNIQUE KEY uq_a(a),KEY idx_mix(amount,a),KEY \`键\`\`INVISIBLE\`(a,amount)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='${marker}:subject'`);
      await sql(`INSERT INTO ${table('subject')} VALUES(18446744073709551614,9007199254740993,123456789012345678.123456,X'00FF'),(18446744073709551615,-9,-1.000001,NULL)`);
      const definition = async (name: string) => String((await sql(`SHOW CREATE TABLE ${table(name)}`))[0]['Create Table']);
      const physical = async (name: string) => sql(`SELECT CAST(t.TABLE_ID AS CHAR) AS tableId,CAST(i.INDEX_ID AS CHAR) AS indexId,i.NAME AS name,CAST(i.TYPE AS CHAR) AS type FROM information_schema.${binding.dialect === 'mysql' && binding.version.startsWith('8.') ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES'} t JOIN information_schema.${binding.dialect === 'mysql' && binding.version.startsWith('8.') ? 'INNODB_INDEXES' : 'INNODB_SYS_INDEXES'} i ON i.TABLE_ID=t.TABLE_ID WHERE BINARY t.NAME=BINARY ? ORDER BY i.INDEX_ID`,[database+'/'+name]);
      const rows = async (name: string) => {
        if(name==='subject')return sql(`SELECT CAST(id AS CHAR) AS id,CAST(a AS CHAR) AS a,CAST(amount AS CHAR) AS amount,HEX(payload) AS payload FROM ${table(name)} ORDER BY id`);
        if(name==='auto_only')return sql(`SELECT k,CAST(id AS CHAR) AS id FROM ${table(name)} ORDER BY k`);
        return sql(`SELECT * FROM ${table(name)} ORDER BY 1`);
      };
      const get = async (name: string) => { const result=await invoke<TableIndexGetOutput>('schema.indexes.get',{connectionId:binding.profile.id,database,table:name,taskId:crypto.randomUUID(),connectionRevision:1,includeOptimizerFacts:true});expect(result.error).toBeUndefined();expect(result.facts).toHaveLength(1);return result.value!; };
      const preview = (snapshot:TableIndexGetOutput,name:string,visible:boolean)=>invoke<TableIndexPreviewOutput>('schema.indexes.preview',{snapshotId:snapshot.snapshotId,patches:[{op:'alter',indexRef:snapshot.indexes.find(index=>index.name===name)!.indexRef,changes:{optimizerVisible:visible}}],taskId:crypto.randomUUID(),connectionRevision:1});
      const apply = (value:TableIndexPreviewOutput,write:boolean,acks=value.requiredAcknowledgements)=>invoke<TableIndexApplyOutput>('schema.indexes.apply',{previewToken:value.previewToken,acknowledgements:acks,taskId:crypto.randomUUID(),connectionRevision:1},write?value.sql:undefined);
      const baseline=await rows('subject'), baselineDefinition=await definition('subject'), baselinePhysical=await physical('subject');expect(baseline.map(row=>row.id)).toEqual(['18446744073709551614','18446744073709551615']);expect(baseline[0].amount).toBe('123456789012345678.123456');expect(baseline[0].payload).toBe('00FF');
      let roundtrips=0, uniqueChecked=false, foreignChildChecked=false, foreignParentChecked=false, autoChecked=false, clusteredChecked=false, defaultRefused=false;
      const modern = binding.version !== '5.7.44';
      if (!modern) {
        const snapshot=await get('subject'), target=snapshot.indexes.find(index=>index.name==='idx_mix')!;
        expect(target.optimizer?.access.allowed).toBe(false); const refused=await preview(snapshot,'idx_mix',false);expect(refused.error).toBeInstanceOf(Error);expect(refused.facts.flatMap(fact=>fact.writes)).toEqual([]);expect(await rows('subject')).toEqual(baseline);
        await invoke('schema.indexes.release',{snapshotId:snapshot.snapshotId});defaultRefused=true;
      } else {
        await sql(`CREATE TABLE ${table('no_pk')}(first_id INT NOT NULL,second_id INT NOT NULL,nullable_id INT NULL,UNIQUE KEY uq_first(first_id),UNIQUE KEY uq_second(second_id),UNIQUE KEY uq_nullable(nullable_id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='${marker}:no_pk'`);
        await sql(`INSERT INTO ${table('no_pk')} VALUES(1,2,NULL),(3,4,5)`);
        await sql(`CREATE TABLE ${table('auto_only')}(k INT NOT NULL PRIMARY KEY,id BIGINT NOT NULL AUTO_INCREMENT,KEY sole(id)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='${marker}:auto_only'`);await sql(`INSERT INTO ${table('auto_only')} VALUES(1,7)`);
        await sql(`CREATE TABLE ${table('parent')}(id INT NOT NULL PRIMARY KEY,u INT NOT NULL,UNIQUE KEY uq_parent(u)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='${marker}:parent'`);await sql(`INSERT INTO ${table('parent')} VALUES(1,7)`);
        await sql(`CREATE TABLE ${table('child')}(id INT NOT NULL PRIMARY KEY,ref_id INT,KEY idx_ref(ref_id),CONSTRAINT fk_parent FOREIGN KEY(ref_id) REFERENCES ${table('parent')}(u)) ENGINE=InnoDB ROW_FORMAT=DYNAMIC COMMENT='${marker}:child'`);await sql(`INSERT INTO ${table('child')} VALUES(1,7)`);
        const noPk=await get('no_pk'), primary=await get('subject');expect(noPk.indexes.find(index=>index.name==='uq_first')!.optimizer?.access.allowed).toBe(false);expect(primary.indexes.find(index=>index.name==='PRIMARY')!.optimizer?.access.allowed).toBe(false);
        const role=await physical('no_pk');expect(role.find(index=>index.name==='uq_first')?.type).toBe('3');expect(role.find(index=>index.name==='uq_second')?.type).toBe('2');
        for(const [snapshot,name] of [[noPk,'uq_first'],[primary,'PRIMARY']] as const){const refused=await preview(snapshot,name,false);expect(refused.error).toBeInstanceOf(Error);expect(refused.facts.flatMap(fact=>fact.writes)).toEqual([]);await invoke('schema.indexes.release',{snapshotId:snapshot.snapshotId});}clusteredChecked=true;
        /** 每一目标均由真实get/ref/preview驱动；observer独立记录行、SHOW和全部原生索引身份。 */
        const roundtrip=async(name:string,indexName:string,onHidden?:()=>Promise<void>)=>{
          const original=await definition(name), originalRows=await rows(name), originalPhysical=await physical(name), snapshot=await get(name), target=snapshot.indexes.find(index=>index.name===indexName)!;
          expect(target.optimizer).toEqual({visible:true,access:{allowed:true,reasons:[]}});
          const noOp=await preview(snapshot,indexName,true);expect(noOp.error).toBeInstanceOf(Error);expect(noOp.facts.flatMap(fact=>fact.writes)).toEqual([]);
          const prepared=await preview(snapshot,indexName,false);expect(prepared.error).toBeUndefined();const value=prepared.value!;
          expect(value.requiredAcknowledgements).toEqual(['ddl-implicit-commit','external-ddl-window','index-optimizer-change']);expect(value.sql).toContain('ALTER INDEX '+quote.identifier(indexName));expect(value.sql).toContain('ALGORITHM=INPLACE, LOCK=NONE');expect(value.sql).not.toMatch(/DROP INDEX|ADD INDEX|MODIFY COLUMN/);
          expect(prepared.facts.flatMap(fact=>fact.writes)).toEqual([]);expect(await definition(name)).toBe(original);expect(await rows(name)).toEqual(originalRows);
          const done=await apply(value,true);expect(done.error).toBeUndefined();expect(done.value).toMatchObject({ddlSubmitted:true,ddlCompleted:true,definitionVerified:true});expect(done.facts.flatMap(fact=>fact.writes)).toEqual([value.sql]);
          const repeated=await apply(value,false);expect(repeated.error).toBeInstanceOf(Error);expect(repeated.facts).toHaveLength(0);expect(await physical(name)).toEqual(originalPhysical);expect(await rows(name)).toEqual(originalRows);
          if(onHidden)await onHidden();
          const expectedRows=await rows(name), hidden=await get(name), existing=hidden.indexes.find(index=>index.name===indexName)!;expect(existing.optimizer).toEqual({visible:false,access:{allowed:true,reasons:[]}});expect(existing.access.drop.allowed).toBe(false);
          const restoration=await preview(hidden,indexName,true);expect(restoration.error).toBeUndefined();const restored=await apply(restoration.value!,true);expect(restored.error).toBeUndefined();expect(restored.value).toMatchObject({definitionVerified:true});expect(restored.facts.flatMap(fact=>fact.writes)).toEqual([restoration.value!.sql]);
          const finalDefinition=await definition(name);if(name==='auto_only')expect(finalDefinition.replace(/ AUTO_INCREMENT=\d+/, '')).toBe(original.replace(/ AUTO_INCREMENT=\d+/, ''));else expect(finalDefinition).toBe(original);
          expect(await rows(name)).toEqual(expectedRows);expect(await physical(name)).toEqual(originalPhysical);roundtrips++;
        };
        await roundtrip('subject','idx_mix');
        await roundtrip('subject','uq_a',async()=>{await rejectsSql(`INSERT INTO ${table('subject')} VALUES(1,9007199254740993,0,X'')`,1062);uniqueChecked=true;});
        await roundtrip('subject','键`INVISIBLE');
        await roundtrip('no_pk','uq_second');await roundtrip('no_pk','uq_nullable');
        await roundtrip('auto_only','sole',async()=>{await sql(`INSERT INTO ${table('auto_only')}(k) VALUES(2)`);expect((await rows('auto_only')).map(row=>row.id)).toEqual(['7','8']);autoChecked=true;});
        await roundtrip('parent','uq_parent',async()=>{await rejectsSql(`DELETE FROM ${table('parent')} WHERE u=7`,1451);foreignParentChecked=true;});
        await roundtrip('child','idx_ref',async()=>{await rejectsSql(`INSERT INTO ${table('child')} VALUES(2,99)`,1452);foreignChildChecked=true;});
        expect(await rows('subject')).toEqual(baseline);expect(roundtrips).toBe(8);
      }
      expect(await definition('subject')).toBe(baselineDefinition);expect(await rows('subject')).toEqual(baseline);expect(await physical('subject')).toEqual(baselinePhysical);
      process.stdout.write(JSON.stringify({专项:'索引优化器',阶段:'行为审计',端口:binding.profile.port,版本:observer.status.version,方言:binding.dialect,严格TLS:!!binding.profile.tls?.enabled,往返数量:roundtrips,原精度字节保持:true,物理表索引身份保持:true,唯一约束仍生效:uniqueChecked,子外键仍生效:foreignChildChecked,父外键仍生效:foreignParentChecked,自增仍生效:autoChecked,真实聚簇保护:clusteredChecked,五点七明确拒绝:defaultRefused,MDL取消限权:'本轮未验'})+'\n');
      await owner.step(()=>engine!.closeAll());const taskFacts=facts.filter(fact=>fact.scope!=='observer');assertIndexOptimizerReleased(taskFacts,false);
      const ids=[...new Set(taskFacts.map(fact=>fact.id))];if(ids.length)expect(await sql(`SELECT ID FROM information_schema.PROCESSLIST WHERE ID IN (${ids.join(',')})`)).toHaveLength(0);
      const names=modern?['auto_only','child','no_pk','parent','subject']:['subject'];
      expect(await sql('SELECT TABLE_NAME AS name,TABLE_COMMENT AS marker,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME',[database])).toEqual(names.map(name=>({name,marker:marker+':'+name,kind:'BASE TABLE'})));
      for(const [view,column] of [['TRIGGERS','TRIGGER_SCHEMA'],['ROUTINES','ROUTINE_SCHEMA'],['EVENTS','EVENT_SCHEMA']])expect(await sql(`SELECT 1 FROM information_schema.${view} WHERE BINARY ${column}=BINARY ? LIMIT 1`,[database])).toHaveLength(0);
      if(created!=='confirmed'||!/^dbark_e2e_iopt_[a-f0-9]{32}$/.test(database))throw Error('索引优化器原资源归属未证明，拒绝清理');
      await sql('DROP DATABASE '+db);created='absent';expect(await sql('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?',[database])).toHaveLength(0);
      await owner.step(()=>closeIndexOptimizerObserver(observer!));assertIndexOptimizerReleased(facts,false);owner.finish();complete=true;audit.watch=undefined;audit.check=undefined;audit.scope='';
      process.stdout.write(JSON.stringify({专项:'索引优化器',阶段:'精确清理',端口:binding.profile.port,已清理数据库:database,原生流全部关闭:true,原任务线程残留:0,实际DDL数:taskFacts.flatMap(fact=>fact.writes).length})+'\n');
    }catch(reason){owner.stop();retained=true;process.stdout.write(JSON.stringify({专项:'索引优化器',阶段:'失败保留',端口:binding.profile.port,保留现场:true,数据库:database,数据库状态:created,原生线程:facts.map(fact=>({id:fact.id,pending:fact.pending,closed:fact.sawClose,closeFailed:fact.closeFailed}))})+'\n');throw reason;}
    finally{if(!complete&&observer)try{await observer.close({strict:true});}catch{/* 原失败和资源未知保持，不另建连接补救。 */}}
  });
});
