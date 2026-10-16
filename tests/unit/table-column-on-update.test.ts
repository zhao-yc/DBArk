import {describe,expect,it} from 'vitest';
import {parseTableColumnDefinition} from '../../src/engine/tableColumnDefinition';
import {buildTableColumnPatchSql} from '../../src/engine/tableColumnPatchSql';
import {columnOnUpdateAccess,readColumnOnUpdate,columnPatchAccess,type ColumnOnUpdatePatch,type TableDefinitionContext,type TableColumnView} from '../../src/shared/tableColumnPatches';
import {validateCommand} from '../../src/shared/validation';
import {makeColumnAlter,validateColumnDrafts} from '../../src/renderer/columnPatches';

const mysql:TableDefinitionContext={dialect:'mysql',mode:{ansiQuotes:false,noBackslashEscapes:false}};
/** 原字段包含易混关键字与旁列精确文字量；输出只允许改变目标ON UPDATE源范围。 */
function ddl(type='DATETIME(6)',update=''){return `CREATE TABLE t (id int NOT NULL, updated_at ${type} NOT NULL DEFAULT CURRENT_TIMESTAMP${type.includes('(6)')?'(6)':''} ${update} COMMENT 'ON UPDATE不是属性，DEFAULT也不是', note varchar(20) DEFAULT 'NULL', empty_text varchar(20) DEFAULT '') ENGINE=InnoDB`;}
function model(source:string,context=mysql){return parseTableColumnDefinition(source,context);}
function patch(value:ColumnOnUpdatePatch){return{kind:'alter',columnRef:'updated_at',changes:{onUpdate:value}};}
function plan(source:string,value:unknown,context=mysql,serverVersion='8.4.11'){const document=model(source,context);return buildTableColumnPatchSql(document,[value],{database:'db',serverVersion,columnRefs:new Map(document.columns.map(column=>[column.name,column.name]))});}
const timestamp=(precision=6)=>({kind:'expression' as const,expression:'current-timestamp' as const,precision});

describe('既有字段受控ON UPDATE',()=>{
 it.each([['mysql','5.7.44'],['mysql','8.0.46'],['mysql','8.4.11'],['mariadb','10.11.19-MariaDB'],['mariadb','5.5.5-11.4.13-MariaDB']] as const)('%s %s只修改原普通时间字段', (dialect,version)=>{
  const context={...mysql,dialect},source=ddl('TIMESTAMP(6)'),document=model(source,context),column=document.columns[1];
  expect(columnOnUpdateAccess(column,dialect,version).editable).toBe(true);const result=plan(source,patch(timestamp()),context,version);
  expect(result.clauses).toHaveLength(1);expect(result.sql).toMatch(/MODIFY COLUMN\s+updated_at TIMESTAMP\(6\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(6\)/);expect(result.sql).toContain('ON UPDATE CURRENT_TIMESTAMP(6)');expect(result.sql).toContain("COMMENT 'ON UPDATE不是属性，DEFAULT也不是'");expect(result.preserved.columns).toEqual([document.columns[0].raw,document.columns[2].raw,document.columns[3].raw]);expect(result.sql).not.toContain('ALTER COLUMN');
 });
 it.each([0,3,6])('支持字段精度%d，null仅移除属性且DEFAULT和注释原片段保持',precision=>{
  const type=`DATETIME(${precision})`,source=ddl(type).replace('DEFAULT CURRENT_TIMESTAMP ','DEFAULT CURRENT_TIMESTAMP('+precision+') '),enabled=plan(source,patch(timestamp(precision)));
  expect(enabled.sql).toContain('ON UPDATE CURRENT_TIMESTAMP'+(precision?`(${precision})`:''));
  const old=source.replace(" COMMENT",` ON UPDATE CURRENT_TIMESTAMP(${precision}) COMMENT`),removed=plan(old,patch(null));expect(removed.sql).not.toMatch(/ON UPDATE CURRENT_TIMESTAMP/);expect(removed.sql).toContain(`DEFAULT CURRENT_TIMESTAMP(${precision})`);expect(removed.sql).toContain("COMMENT 'ON UPDATE不是属性，DEFAULT也不是'");
 });
 it('原NOW/零精度受控别名恢复原值不生成SQL，不把字符串或未知表达式当作自动时间',()=>{
  const source=ddl('TIMESTAMP','ON UPDATE now()');expect(readColumnOnUpdate(model(source).columns[1])).toEqual(timestamp(0));expect(()=>plan(source,patch(timestamp(0)))).toThrow('没有实际字段变更');expect(()=>plan(ddl(),patch(null))).toThrow('没有实际字段变更');
  const unknown=model(ddl('DATETIME(6)','ON UPDATE LOCALTIMESTAMP(6)')).columns[1];expect(readColumnOnUpdate(unknown)).toBeUndefined();expect(columnOnUpdateAccess(unknown,'mysql','8.4.11').editable).toBe(false);
 });
 it.each(['DATETIME(6) NOT NULL','TIMESTAMP(6) NOT NULL'])('%s没有DEFAULT时拒绝，绝不为规避隐式行为补DEFAULT',definition=>{
  const source=`CREATE TABLE t (updated_at ${definition}) ENGINE=InnoDB`;expect(columnOnUpdateAccess(model(source).columns[0],'mysql','8.4.11').editable).toBe(false);expect(()=>plan(source,patch(timestamp()))).toThrow('DEFAULT');
 });
 it('未知版本、非时间类型、隐式TIMESTAMP可空性、生成/隐藏/未知属性只读',()=>{
  expect(columnOnUpdateAccess(model(ddl()).columns[1],'mysql','9.0.0').editable).toBe(false);
  for(const definition of ["int DEFAULT 0","TIMESTAMP DEFAULT CURRENT_TIMESTAMP",'DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) INVISIBLE',"DATETIME(6) GENERATED ALWAYS AS (now()) VIRTUAL",'DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) SOMETHING_UNKNOWN','DATETIME(6) DEFAULT (now(6) + interval 1 day)','DATETIME(6) DEFAULT CURRENT_TIMESTAMP(0)']){
   const column=model(`CREATE TABLE t (updated_at ${definition}) ENGINE=InnoDB`).columns[0];expect(columnOnUpdateAccess(column,'mysql','8.4.11').editable,definition).toBe(false);expect(()=>plan(`CREATE TABLE t (updated_at ${definition}) ENGINE=InnoDB`,patch(null))).toThrow();
  }
 });
 it('同列混合修改、错误精度拒绝，不能扩大至类型转换或新增字段',()=>{
  expect(()=>plan(ddl(),patch(timestamp(0)))).toThrow('精度');expect(()=>plan(ddl(),{...patch(null),changes:{onUpdate:null,comment:'改动'}})).toThrow('混合');
  const base={snapshotId:'snapshot',taskId:'task'};
  for(const onUpdate of ['',undefined,{...timestamp(),sql:'NOW()'},{...timestamp(),precision:7},{kind:'expression',expression:'uuid'}])expect(()=>validateCommand('schema.columns.preview',{...base,patches:[patch(onUpdate as any)]})).toThrow();
  expect(validateCommand('schema.columns.preview',{...base,patches:[patch(null)]})).toMatchObject({patches:[{changes:{onUpdate:null}}]});
  expect(()=>validateCommand('schema.columns.preview',{...base,patches:[{kind:'add',clientKey:'new',name:'ts',type:{kind:'temporal',type:'DATETIME',precision:6},nullable:true,default:{kind:'none'},comment:'',position:{kind:'last'},onUpdate:null}]})).toThrow();
 });
 it('真实UI草稿助手未勾修改及恢复原值不留补丁，移除null不能被空值合并吞掉',()=>{
  const column=model(ddl('DATETIME(6)','ON UPDATE CURRENT_TIMESTAMP(6)')).columns[1],view:TableColumnView={columnRef:'updated_at',name:column.name,ordinal:2,typeSql:column.type.raw,nullable:column.nullable,default:column.default,comment:column.comment,rawDefinition:column.raw,onUpdate:readColumnOnUpdate(column),access:columnPatchAccess(column,'mysql','8.4.11')};
  expect(makeColumnAlter(view,{})).toBeNull();expect(makeColumnAlter(view,{onUpdate:timestamp()})).toBeNull();expect(makeColumnAlter(view,{onUpdate:{kind:'expression',expression:'current-timestamp'}})).toBeNull();
  const removed=makeColumnAlter(view,{onUpdate:null});expect(removed).toEqual(patch(null));expect(validateColumnDrafts([view],[removed!],30)).toEqual([removed]);
  expect(()=>validateColumnDrafts([view],[{...removed!,changes:{onUpdate:timestamp(0)}} as any],30)).toThrow('精度');expect(()=>validateColumnDrafts([view],[{...removed!,changes:{onUpdate:null,comment:'同时改'}} as any],30)).toThrow('混合');
 });
});
