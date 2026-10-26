import { isDeepStrictEqual } from 'node:util';
import type { FilterGroup, FilterRule, SortRule } from '../../src/shared/contracts';
import { bindTableValueOptionsTarget, type TableValueOptionsLifetime } from './tableValueOptionsIntegration';

export const tableFilteredDeleteIntegrationGate='DBARK_TABLE_FILTERED_DELETE_TEST';
/** 独立验收期望：只认可已实测的两个MySQL补丁版本，不调用产品能力判断函数自证。 */
export function tableFilteredDeleteExpectedCapability(dialect:string,version:string):boolean{return dialect==='mysql'&&/^(8\.0\.46|8\.4\.11)(?:-[A-Za-z0-9_.+-]+)?$/.test(version);}
export const tableFilteredDeleteExpectedVersionError='当前数据库版本尚不能保证跨页删除期间的外键结构隔离，已禁止全部筛选行删除；可使用当前页删除或 SQL 工作区。';
/** 仅原六实例双门可载入；环境存在性或其它专项开关漂移后永久停链。 */
export function bindTableFilteredDeleteTarget(read:()=>Record<string,string|undefined>,id:string){let stopped=false;return bindTableValueOptionsTarget(()=>{const env=read();if(stopped||env[tableFilteredDeleteIntegrationGate]!=='1'||['DBARK_TABLE_VALUE_OPTIONS_TEST','DBARK_CSV_HEADER_TEST','DBARK_FILTERED_SELECT_TEST','DBARK_TABLE_FILTERED_EXPORT_TEST','DBARK_RESULT_INSERT_TEST','DBARK_QUERY_INSERT_INTEGRATION_ENABLED','DBARK_FILE_IMPORT_TRANSACTION_TEST','DBARK_TABLE_FILTERED_DELETE_UI_TEST','DBARK_TABLE_FILTERED_UPDATE_TEST','DBARK_TABLE_FILTERED_UPDATE_UI_TEST'].some(key=>Boolean(env[key]))){stopped=true;throw Error('全部筛选行删除必须独立双门，原环境漂移后保留现场');}return{...env,DBARK_TABLE_VALUE_OPTIONS_TEST:env[tableFilteredDeleteIntegrationGate]};},id);}
const quote=(value:string)=>'`'+value.replaceAll('`','``')+'`',literal=(value:string)=>"_utf8mb4 X'"+Buffer.from(value,'utf8').toString('hex')+"'";
export interface FilteredDeleteFixtureRow { index:number;id:string;label:string|null;amount:string|null;payloadHex:string|null;bitHex:string;epoch:string;note:string|null;side:string; }
/** 手工整数/原字节造数，不使用产品筛选器、SQL编译器或buildChanges构造期望。 */
export function planTableFilteredDeleteFixture(database:string,marker:string,kind:'main'|'cancel'|'mdl'){
  if(!/^dbark_filtereddelete_[a-f0-9]{32}$/.test(database)||!/^dbark-table-filtered-delete:[a-f0-9]{32}$/.test(marker))throw Error('全部筛选行删除隔离资源身份无效');
  const table=(name:string)=>quote(database)+'.'+quote(name),row=(index:number):FilteredDeleteFixtureRow=>({index,id:(9007199254740992n+BigInt(index)).toString(),label:index<=61||index===82?index%2?'Alpha':'Beta':index%2?null:'Gamma',amount:index%5?'123456789012345678.'+String(index).padStart(12,'0'):null,payloadHex:index%3===0?null:index%3===1?'':'00FF'+index.toString(16).padStart(2,'0').toUpperCase(),bitHex:index.toString(16).padStart(4,'0').toUpperCase(),epoch:'1700000000.'+String(index).padStart(6,'0'),note:index%7?'原值-'+index+"\nNULL'\\尾部":null,side:'旁列-'+index});
  const rows=Array.from({length:81},(_,index)=>row(index+1)),late=row(82),names=kind==='main'?['__owner','cascade_child','cascade_parent','myisam','no_key','restrict_child','restrict_parent','subject','trigger_subject']:kind==='mdl'?['__owner','fk_child','subject']:['__owner','cancel_subject'];
  const fields='id BIGINT UNSIGNED NOT NULL,label VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,amount DECIMAL(30,12) NULL,payload BLOB NULL,bits BIT(16) NOT NULL,stamp TIMESTAMP(6) NULL,note TEXT NULL,side_note VARCHAR(80) NOT NULL';
  const tuple=(value:FilteredDeleteFixtureRow)=>'('+[value.id,value.label===null?'NULL':literal(value.label),value.amount===null?'NULL':"CAST('"+value.amount+"' AS DECIMAL(30,12))",value.payloadHex===null?'NULL':"X'"+value.payloadHex.toLowerCase()+"'","b'"+BigInt('0x'+value.bitHex).toString(2)+"'",'FROM_UNIXTIME('+value.epoch+')',value.note===null?'NULL':literal(value.note),literal(value.side)].join(',')+')';
  const insert=(name:string,values:readonly FilteredDeleteFixtureRow[])=>'INSERT INTO '+table(name)+' (id,label,amount,payload,bits,stamp,note,side_note) VALUES '+values.map(tuple).join(',');
  const creates=['CREATE DATABASE '+quote(database)+' DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin','CREATE TABLE '+table('__owner')+' (marker VARCHAR(100) NOT NULL PRIMARY KEY) ENGINE=InnoDB'];
  const createOrder=names.filter(name=>name!=='__owner').sort((a,b)=>Number(a.endsWith('_child'))-Number(b.endsWith('_child'))||a.localeCompare(b));
  for(const name of createOrder){const relation=name==='cascade_child'?',CONSTRAINT `fk_cascade` FOREIGN KEY(id) REFERENCES '+table('cascade_parent')+'(id) ON DELETE CASCADE':name==='restrict_child'?',CONSTRAINT `fk_restrict` FOREIGN KEY(id) REFERENCES '+table('restrict_parent')+'(id) ON DELETE RESTRICT':'';creates.push('CREATE TABLE '+table(name)+' ('+fields+(name==='no_key'?'':',PRIMARY KEY(id)')+relation+') ENGINE='+(name==='myisam'?'MyISAM':'InnoDB'));}
  const trigger=kind==='main'?'CREATE TRIGGER '+table('guard_before_delete')+' BEFORE DELETE ON '+table('trigger_subject')+" FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='禁止删除'":undefined;
  if(trigger)creates.push(trigger);
  const initialRows=(name:string)=>['subject','cancel_subject','cascade_parent','restrict_parent'].includes(name)?rows:[rows[0]];
  const seeds=['INSERT INTO '+table('__owner')+" VALUES ('"+marker+"')",...createOrder.map(name=>insert(name,initialRows(name)))];
  const filters:FilterRule[]=[{column:'label',operator:'=',value:'Alpha'},{column:'label',operator:'=',value:'Beta'},{column:'id',operator:'>=',value:'9007199254740993'},{column:'amount',operator:'>',value:'999999999999999999.999999999999',enabled:false},{column:'stamp',operator:'>=',value:'2000-01-01 00:00:00.000000'}],filterGroup:FilterGroup={mode:'all',children:[2,3,4,{mode:'any',children:[0,1]}]},sort:SortRule[]=[{column:'label',direction:'ASC'},{column:'id',direction:'DESC'}];
  const matching=[...Array.from({length:31},(_,index)=>61-index*2),...Array.from({length:30},(_,index)=>60-index*2)].map(index=>rows[index-1]);
  const observe=(value:FilteredDeleteFixtureRow)=>({id:value.id,labelHex:value.label===null?null:Buffer.from(value.label).toString('hex').toUpperCase(),amount:value.amount,payloadHex:value.payloadHex,bitHex:value.bitHex,epoch:value.epoch,noteHex:value.note===null?null:Buffer.from(value.note).toString('hex').toUpperCase(),sideHex:Buffer.from(value.side).toString('hex').toUpperCase()});
  const readRows=(name:string)=>'SELECT CAST(id AS CHAR) AS id,HEX(label) AS labelHex,CAST(amount AS CHAR) AS amount,HEX(payload) AS payloadHex,LPAD(HEX(bits),4,\'0\') AS bitHex,CAST(UNIX_TIMESTAMP(stamp) AS CHAR) AS epoch,DATE_FORMAT(stamp,\'%Y-%m-%d %H:%i:%s.%f\') AS stamp,HEX(note) AS noteHex,HEX(side_note) AS sideHex FROM '+table(name)+' ORDER BY id ASC';
  const fill='服务器整批\n精确新值',secondFill='仅原快照再次修改',concurrent='独立CAS并发新值';
  const conflict={sql:'UPDATE '+table('subject')+' SET note=? WHERE id=CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED) AND CAST(note AS BINARY)=CAST(? AS BINARY)',values:[concurrent,rows[0].id,rows[0].note]};
  return{database,marker,kind,table,rows,late,names,creates,seeds,initialRows,mdlSql:'ALTER TABLE '+table('fk_child')+' ADD CONSTRAINT `fk_mdl` FOREIGN KEY(id) REFERENCES '+table('subject')+'(id) ON DELETE CASCADE',drop:'DROP DATABASE '+quote(database),triggerName:trigger?'guard_before_delete':undefined,filters,filterGroup,filterMode:'all' as const,sort,matching,observe,readRows,fill,secondFill,concurrent,conflict,lateInsert:insert('subject',[late]),lockSql:'SELECT id FROM '+table('cancel_subject')+' WHERE id=CAST(CAST(? AS DECIMAL(20,0)) AS UNSIGNED) FOR UPDATE',lockId:rows[0].id};
}
export type TableFilteredDeleteFixture=ReturnType<typeof planTableFilteredDeleteFixture>;
export const tableFilteredDeleteZoneSql='SELECT @@SESSION.time_zone AS timeZone,@@system_time_zone AS systemTimeZone,CAST(TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()) AS CHAR) AS utcOffset';
const metadata=[
  'SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COLUMN_COMMENT AS comment, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
  'SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS columnName, SUB_PART AS subPart, INDEX_TYPE AS indexType, COLLATION AS sortDirection FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX',
  'SELECT k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS columnName, k.REFERENCED_TABLE_SCHEMA AS referencedDatabase, k.REFERENCED_TABLE_NAME AS referencedTable, k.REFERENCED_COLUMN_NAME AS referencedColumn, r.UPDATE_RULE AS onUpdate, r.DELETE_RULE AS onDelete FROM information_schema.KEY_COLUMN_USAGE k LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
  'SELECT t.ENGINE AS engine, t.TABLE_TYPE AS tableType, t.TABLE_COLLATION AS collation, t.TABLE_COMMENT AS comment, c.CHARACTER_SET_NAME AS charset FROM information_schema.TABLES t LEFT JOIN information_schema.COLLATIONS c ON c.COLLATION_NAME = t.TABLE_COLLATION WHERE t.TABLE_SCHEMA = ? AND t.TABLE_NAME = ?',
];
/** 只接受原固定scope、准确随机表、原值及控制语句；独立手写UPDATE和快照SELECT。 */
export function createTableFilteredDeleteAudit(plan:TableFilteredDeleteFixture,writes:ReadonlySet<string>,dialect:'mysql'|'mariadb',cancellable:(id:number,scope:string)=>boolean,owned:(id:number)=>boolean){
  const sent:{sql:string;values:readonly unknown[];scope:string}[]=[],rejected:{sql:string;scope:string}[]=[],rules=new Map<string,unknown[][]>(),fixture=new Set([...plan.creates,...plan.seeds,plan.drop,plan.lateInsert]);
  const add=(sql:string,scope:string,values:unknown[]=[])=>{const key=JSON.stringify([scope,sql]);rules.set(key,[...rules.get(key)??[],values]);};
  const identity=`SELECT @@version AS version,@@hostname AS hostname,CAST(@@port AS CHAR) AS port,CAST(@@server_id AS CHAR) AS serverId,CURRENT_USER() AS currentUser,CAST(CONNECTION_ID() AS CHAR) AS connectionId,CAST((@@sql_quote_show_create+0) AS CHAR) AS quoteShowCreate,@@character_set_connection AS charset,@@collation_connection AS collation,${dialect==='mysql'?'@@server_uuid':'NULL'} AS uuid`;
  const targetSql=(name:string)=>'SELECT TABLE_SCHEMA AS databaseName,TABLE_NAME AS tableName,TABLE_TYPE AS kind FROM information_schema.TABLES WHERE CAST(TABLE_SCHEMA AS BINARY)=CAST(CONVERT(X\''+Buffer.from(plan.database).toString('hex')+'\' USING utf8mb4) AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(CONVERT(X\''+Buffer.from(name).toString('hex')+'\' USING utf8mb4) AS BINARY) LIMIT 2';
  const target=(scope:string,name:string)=>{add('SET SESSION foreign_key_checks=1',scope);add('SELECT CAST(@@SESSION.foreign_key_checks AS CHAR) AS foreignKeyChecks',scope);for(const statement of metadata){let position=0;add(statement.replace(/\?/g,()=>literal([plan.database,name][position++]))+' LIMIT 4097',scope);}add('SELECT CONSTRAINT_SCHEMA AS databaseName,TABLE_NAME AS tableName,CONSTRAINT_NAME AS constraintName,UNIQUE_CONSTRAINT_SCHEMA AS parentDatabase,REFERENCED_TABLE_NAME AS parentTable,DELETE_RULE AS onDelete FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CAST(UNIQUE_CONSTRAINT_SCHEMA AS BINARY)=CAST('+literal(plan.database)+' AS BINARY) AND CAST(REFERENCED_TABLE_NAME AS BINARY)=CAST('+literal(name)+' AS BINARY) ORDER BY CAST(CONSTRAINT_SCHEMA AS BINARY),CAST(TABLE_NAME AS BINARY),CAST(CONSTRAINT_NAME AS BINARY) LIMIT 4097',scope);for(const sql of [identity,targetSql(name),'SELECT @@SESSION.sql_mode AS sqlMode','SELECT @@SESSION.sql_mode AS mode LIMIT 4097','SHOW CREATE TABLE '+plan.table(name),'SHOW GRANTS','SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE CAST(EVENT_OBJECT_SCHEMA AS BINARY)=CAST('+literal(plan.database)+' AS BINARY) AND CAST(EVENT_OBJECT_TABLE AS BINARY)=CAST('+literal(name)+' AS BINARY) LIMIT 1',tableFilteredDeleteZoneSql])add(sql,scope);};
  for(const name of plan.names){add('SHOW CREATE TABLE '+plan.table(name),'observer');if(name!=='__owner'){add(plan.readRows(name),'observer');for(const sql of metadata)add(sql,'metadata.table:'+name,[plan.database,name]);add('SHOW CREATE TABLE '+plan.table(name),'metadata.table:'+name);add('SELECT @@SESSION.sql_mode AS mode','metadata.table:'+name);}}
  for(const sql of ['SELECT @@hostname AS hostname,@@port AS port,@@server_id AS serverId,@@version_compile_os AS os,@@lower_case_table_names AS lowerNames','SELECT @@server_uuid AS uuid',tableFilteredDeleteZoneSql,'SELECT marker FROM '+plan.table('__owner')])add(sql,'observer');
  for(const sql of ['SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE BINARY SCHEMA_NAME=BINARY ?','SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE BINARY TABLE_SCHEMA=BINARY ? ORDER BY BINARY TABLE_NAME','SELECT TRIGGER_NAME AS name FROM information_schema.TRIGGERS WHERE BINARY TRIGGER_SCHEMA=BINARY ? ORDER BY BINARY TRIGGER_NAME','SELECT 1 FROM information_schema.ROUTINES WHERE BINARY ROUTINE_SCHEMA=BINARY ? LIMIT 1','SELECT 1 FROM information_schema.EVENTS WHERE BINARY EVENT_SCHEMA=BINARY ? LIMIT 1','SELECT ID FROM information_schema.PROCESSLIST WHERE BINARY DB=BINARY ?'])add(sql,'observer',[plan.database]);
  if(plan.kind==='main')add(plan.conflict.sql,'observer',plan.conflict.values);
  if(plan.kind==='mdl')for(const sql of ['SET SESSION foreign_key_checks=0','SELECT CAST(@@SESSION.foreign_key_checks AS CHAR) AS foreignKeyChecks',plan.mdlSql])add(sql,'mdl-ddl');
  if(plan.kind==='cancel'){add('START TRANSACTION','locker');add(plan.lockSql,'locker',[plan.lockId]);add('ROLLBACK','locker');}
  return{sent,rejected,
    registerMode(scope:string,original:string,zone:string){if(!/^[A-Z0-9_,]*$/i.test(original)||!/^[-A-Za-z0-9_+/:.]{1,100}$/.test(zone))throw Error('全部筛选行原会话模式或时区未知');add("SET SESSION sql_mode = '"+[...new Set([...original.split(',').filter(Boolean),'STRICT_ALL_TABLES','NO_AUTO_VALUE_ON_ZERO'])].sort().join(',')+"'",scope);add("SET SESSION time_zone = '"+zone+"'",scope);add('SELECT @@SESSION.sql_mode AS sqlMode,@@SESSION.time_zone AS timeZone',scope);},
    preview(scope:string,name:string,range:'main'|'all'){
      target(scope,name);for(const sql of ['SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ','START TRANSACTION READ ONLY','SELECT 1 FROM '+plan.table(name)+' LIMIT 0','ROLLBACK AND NO CHAIN NO RELEASE','SHOW WARNINGS LIMIT 21'])add(sql,scope);
      const where=range==='main'?' WHERE ((`id` >= CAST(CAST('+literal('9007199254740993')+' AS DECIMAL(20,0)) AS UNSIGNED)) AND (`stamp` >= '+literal('2000-01-01 00:00:00.000000')+') AND ((`label` = '+literal('Alpha')+') OR (`label` = '+literal('Beta')+')))':'';
      add('SELECT `id`, `label`, `amount`, `payload`, `bits`, `stamp`, `note`, `side_note`, CAST(UNIX_TIMESTAMP(`stamp`) AS CHAR) AS `__dbark_epoch_0` FROM '+plan.table(name)+where+' ORDER BY '+(range==='main'?'`label` ASC, `id` DESC':'`id` ASC'),scope);
    },
    apply(scope:string,name:string,rows:readonly FilteredDeleteFixtureRow[],stamps:ReadonlyMap<string,string>){
      target(scope,name);for(const sql of ['START TRANSACTION','DELETE FROM '+plan.table(name)+' WHERE 0','ROLLBACK','COMMIT'])add(sql,scope);
      const update='DELETE FROM '+plan.table(name)+' WHERE `id` <=> ? AND BINARY CONVERT(`label` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND `amount` <=> ? AND `payload` <=> ? AND `bits` <=> CAST(CONV(HEX(?),16,10) AS UNSIGNED) AND `stamp` <=> ? AND BINARY CONVERT(`note` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND BINARY CONVERT(`side_note` USING utf8mb4) <=> BINARY CONVERT(? USING utf8mb4) AND UNIX_TIMESTAMP(`stamp`) <=> CAST(? AS DECIMAL(20,6))';
      for(const row of rows){const stamp=stamps.get(row.id);if(typeof stamp!=='string')throw Error('缺少独立观察原会话TIMESTAMP原文');add(update,scope,[row.id,row.label,row.amount,row.payloadHex===null?null:Buffer.from(row.payloadHex,'hex'),Buffer.from(row.bitHex,'hex'),stamp,row.note,row.side,row.epoch]);}
      return update;
    },
    assert(sql:string,values:readonly unknown[],scope:string):void{
      if(!Array.isArray(values)||Reflect.ownKeys(values).length!==values.length+1||values.some((_,index)=>!Object.hasOwn(Object.getOwnPropertyDescriptor(values,String(index))??{},'value')))throw Error('全部筛选行原参数不是自有稠密值');
      const kill=/^KILL (?:CONNECTION|QUERY) ([1-9]\d*)$/.exec(sql),thread=scope==='observer'&&['SELECT ID FROM information_schema.PROCESSLIST WHERE ID=?','SELECT ID AS id,STATE AS state,INFO AS info FROM information_schema.PROCESSLIST WHERE ID=?','SELECT trx_mysql_thread_id AS id,trx_state AS state FROM information_schema.innodb_trx WHERE trx_mysql_thread_id=?'].includes(sql)&&values.length===1&&typeof values[0]==='number'&&owned(values[0]);
      if(!(scope==='observer'&&fixture.has(sql)&&writes.has(sql)&&!values.length||rules.get(JSON.stringify([scope,sql]))?.some(expected=>isDeepStrictEqual(expected,values))||thread||kill&&!values.length&&(scope==='mdl-control'?sql.startsWith('KILL QUERY '):sql.startsWith('KILL CONNECTION '))&&cancellable(Number(kill[1]),scope))){rejected.push({sql,scope});throw Error('全部筛选行拒绝未登记SQL、原参数或作用域');}
      sent.push({sql,scope,values:values.map(value=>Buffer.isBuffer(value)?Buffer.from(value):value)});
    },
  };
}
export interface TableFilteredDeleteSpoolFact {directory:string;path?:string;scope:string;removed:boolean;unlinked:boolean;handles:{closed:boolean;closeCalls:number;methods:string[]}[];}
export type TableFilteredDeleteMdlTerminal<T>={value:T}|{error:unknown};
/** 保留同一个DDL Promise和首次真实终态；主RPC释放产品事务后才能收回异常路径的原观察连接。 */
export function tableFilteredDeleteMdlLifecycle<T>(check:()=>void,onTerminal:(terminal:TableFilteredDeleteMdlTerminal<T>)=>void=()=>undefined){
  let original:Promise<TableFilteredDeleteMdlTerminal<T>>|undefined,terminal:TableFilteredDeleteMdlTerminal<T>|undefined,firstFailure:unknown,failed=false;
  const resources:{id:number;close:()=>Promise<void>;closing?:Promise<void>;closed:boolean}[]=[],closeFailures:{id:number;error:unknown}[]=[];
  const fail=(reason:unknown)=>{if(!failed){failed=true;firstFailure=reason;}};
  /** close只调用一次；返回与物理关闭断言仍由调用方的原连接实现，绝不合成closed事实。 */
  const closeResources=async()=>{
    check();if(original&&!terminal)throw Error('原DDL尚未真实终结，禁止在持锁暂停中等待连接关闭');
    for(const resource of resources){
      if(!resource.closing)resource.closing=(async()=>{check();await resource.close();check();resource.closed=true;})();
      try{await resource.closing;}catch(error){fail(error);if(!closeFailures.some(item=>item.id===resource.id))closeFailures.push({id:resource.id,error});}
    }
    if(closeFailures.length)throw closeFailures[0].error;
  };
  return{
    fail,
    get terminal(){return terminal;},get failed(){return failed;},get failure(){return firstFailure;},get closeFailures(){return closeFailures;},
    get resources(){return resources.map(({id,closed})=>({id,closed}));},
    /** 取得真实物理连接后立即登记，后续观察断言失败也不会丢失其关闭归属。 */
    track(id:number,close:()=>Promise<void>){check();if(!Number.isSafeInteger(id)||id<1||resources.some(resource=>resource.id===id))throw Error('MDL原观察连接身份无效或重复');resources.push({id,close,closed:false});},
    start(action:()=>Promise<T>){
      check();if(original)throw Error('原MDL DDL只允许启动一次');
      const record=(value:TableFilteredDeleteMdlTerminal<T>)=>{terminal=value;onTerminal(value);return value;};
      let launched:Promise<T>;try{launched=action();}catch(error){launched=Promise.reject(error);}
      original=launched.then(value=>record({value}),error=>record({error}));
      return original;
    },
    close:closeResources,
    /** 主RPC finally沿原owner/slot/deadline回收；先等同一DDL原终态，再严格关闭，不重试SQL或close。 */
    async finish(){
      try{check();if(original){await original;check();}await closeResources();}catch(error){fail(error);}
      if(failed)throw firstFailure;
    },
  };
}
/** 被动观察原fs与FileHandle方法；每个底层await前后核同一owner，不改原参数或结果。 */
export function tableFilteredDeleteFileObserver(owner:TableValueOptionsLifetime,prefix:string,scope:()=>string){
  const facts:TableFilteredDeleteSpoolFact[]=[];
  const directoryOf=(path:string)=>facts.find(fact=>path===fact.directory||path===fact.path);
  return{facts,async call(method:string,args:any[],original:()=>Promise<any>):Promise<any>{owner.check();const path=args[0];if(typeof path!=='string')throw Error('全部筛选行spool不是原字符串路径');
    if(method==='mkdtemp'){if(path!==prefix)throw Error('全部筛选行spool临时目录前缀改变');const directory=await original();owner.check();facts.push({directory,scope:scope(),removed:false,unlinked:false,handles:[]});return directory;}
    const fact=directoryOf(path);if(!fact&&method!=='open')throw Error('全部筛选行spool访问未登记原目录');
    const opened=method==='open'?facts.find(value=>path===value.directory+(value.directory.includes('\\')?'\\':'/')+'snapshot.bin'):undefined;if(method==='open'&&!opened)throw Error('全部筛选行spool打开非本例文件');
    const result=await original();owner.check();if(method==='realpath'&&fact&&path===fact.directory){if(result!==fact.directory)fact.directory=result;return result;}
    if(method==='open'){const target=opened!;target.path=path;const handle={closed:false,closeCalls:0,methods:[] as string[]};target.handles.push(handle);for(const name of ['read','write','sync','stat','close']){const native=result[name].bind(result);result[name]=async(...values:any[])=>{owner.check();handle.methods.push(name);if(name==='close')handle.closeCalls++;const output=await native(...values);owner.check();if(name==='close')handle.closed=true;return output;};}}
    if(method==='unlink'&&fact)fact.unlinked=true;if(method==='rmdir'&&fact)fact.removed=true;return result;
  }};
}
