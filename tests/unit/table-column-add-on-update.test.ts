import {describe,expect,it} from 'vitest';
import {parseTableColumnDefinition} from '../../src/engine/tableColumnDefinition';
import {buildTableColumnPatchSql} from '../../src/engine/tableColumnPatchSql';
import {addedColumnOnUpdateAccess,validateColumnPatches,type ColumnPatch,type TableDefinitionContext} from '../../src/shared/tableColumnPatches';
import {validateCommand} from '../../src/shared/validation';

const mysql:TableDefinitionContext={dialect:'mysql',mode:{ansiQuotes:false,noBackslashEscapes:false}},source="CREATE TABLE t(id int NOT NULL,note varchar(20) DEFAULT 'NULL') ENGINE=InnoDB";
/** 新字段只通过原ADD结构表达，精度和默认值分别保留，不借用原列原文或拼接表达式。 */
function added(type:'DATETIME'|'TIMESTAMP'='DATETIME',precision=6):Extract<ColumnPatch,{kind:'add'}>{return{kind:'add',clientKey:'new-time',name:'created_at',type:{kind:'temporal',type,precision},nullable:true,default:{kind:'null'},comment:'新时间',position:{kind:'last'},onUpdate:{kind:'expression',expression:'current-timestamp',precision}};}
function plan(patch:unknown,context=mysql,serverVersion='8.4.11'){const document=parseTableColumnDefinition(source,context);return buildTableColumnPatchSql(document,[patch],{database:'db',serverVersion,columnRefs:new Map(document.columns.map(column=>[column.name,column.name]))});}

describe('新增普通时间字段的受控自动更新',()=>{
 it.each([['mysql','5.7.44'],['mysql','8.0.46'],['mysql','8.4.11'],['mariadb','10.11.19-MariaDB'],['mariadb','5.5.5-11.4.13-MariaDB']] as const)('%s %s新增DATETIME/TIMESTAMP按实际精度单条ADD', (dialect,version)=>{
  for(const[type,precision]of [['DATETIME',0],['DATETIME',3],['TIMESTAMP',6]] as const){const patch=added(type,precision),result=plan(patch,{...mysql,dialect},version);expect(result.clauses).toHaveLength(1);expect(result.sql).toContain(`ADD COLUMN \`created_at\` ${type}(${precision}) NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP${precision?`(${precision})`:''} COMMENT '新时间'`);expect(result.finalColumns.map(column=>column.name)).toEqual(['id','note','created_at']);expect(result.preserved.columns).toHaveLength(2);expect(result.sql).not.toContain('MODIFY');}
 });
 it('省略属性保留原ADD无DEFAULT；显式null须明确DEFAULT，不附加自动属性或补默认',()=>{
  const without=added('TIMESTAMP',0);delete without.onUpdate;without.default={kind:'none'};const none=plan(without);expect(none.sql).not.toContain('DEFAULT');expect(none.sql).not.toContain('ON UPDATE');expect(none.sql).toContain('TIMESTAMP(0) NULL');expect(()=>plan({...without,onUpdate:null})).toThrow('DEFAULT');
  const explicit={...without,default:{kind:'null' as const}},nullPlan=plan({...explicit,onUpdate:null});expect(nullPlan.sql).toBe(plan(explicit).sql);expect(nullPlan.sql).toContain('DEFAULT NULL');expect(nullPlan.sql).not.toContain('ON UPDATE');
 });
 it('显式DEFAULT CURRENT_TIMESTAMP与NOT NULL、注释和FIRST位置分别保持',()=>{
  const patch=added('TIMESTAMP',6);patch.nullable=false;patch.default={kind:'expression',expression:'current-timestamp',precision:6};patch.position={kind:'first'};const value=plan(patch);expect(value.sql).toContain('NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)');expect(value.sql).toContain("COMMENT '新时间' FIRST");expect(value.finalColumns[0].name).toBe('created_at');
 });
 it.each(['无默认','NULL与NOT NULL冲突','自动精度不一致','默认精度不一致','非时间类型'])('%s通过共享校验及原IPC拒绝，不自动修正值',kind=>{
  const patch=added();if(kind==='无默认')patch.default={kind:'none'};if(kind==='NULL与NOT NULL冲突')patch.nullable=false;if(kind==='自动精度不一致')patch.onUpdate={kind:'expression',expression:'current-timestamp',precision:0};if(kind==='默认精度不一致')patch.default={kind:'expression',expression:'current-timestamp',precision:0};if(kind==='非时间类型')patch.type={kind:'integer',type:'INT',unsigned:false};
  expect(()=>validateColumnPatches([patch])).toThrow();expect(()=>validateCommand('schema.columns.preview',{snapshotId:'snapshot',taskId:'preview',patches:[patch]})).toThrow();expect(()=>plan(patch)).toThrow();
 });
 it('未知键、任意SQL、generated与显式undefined仍在原严格IPC拒绝',()=>{
  for(const patch of [{...added(),generated:'now()'},{...added(),sql:'NOW()'},{...added(),onUpdate:undefined},{...added(),onUpdate:'CURRENT_TIMESTAMP'},{...added(),onUpdate:{kind:'expression',expression:'uuid'}},{...added(),onUpdate:{kind:'expression',expression:'current-timestamp',precision:7}}])expect(()=>validateCommand('schema.columns.preview',{snapshotId:'snapshot',taskId:'preview',patches:[patch]})).toThrow();
  const patch=added(),result=validateCommand('schema.columns.preview',{snapshotId:'snapshot',taskId:'preview',patches:[patch]});expect(structuredClone(result)).toMatchObject({patches:[{onUpdate:{precision:6},default:{kind:'null'},nullable:true}]});
 });
 it('版本不外推；新字段界面在DEFAULT/NULL/类型不可靠时不能启用',()=>{
  const patch=added();expect(()=>plan(patch,mysql,'8.4.12')).toThrow('版本');expect(addedColumnOnUpdateAccess(patch,'mysql','8.4.12').editable).toBe(false);expect(addedColumnOnUpdateAccess(patch,'mysql','8.4.11').editable).toBe(true);
  for(const value of [{...patch,nullable:undefined},{...patch,default:{kind:'none' as const}},{...patch,type:{kind:'temporal' as const,type:'DATE' as const}},{...patch,nullable:false}])expect(addedColumnOnUpdateAccess(value,'mysql','8.4.11').editable).toBe(false);
 });
});
