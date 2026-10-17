import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {collationFacts} from '../fixtures/column-collation-facts';
import {buildColumnCollationDefinition,verifyColumnCollationChange} from '../../src/engine/tableColumnCollationSql';
import {parseTableColumnDefinition} from '../../src/engine/tableColumnDefinition';
import type {TrustedIndexDefinition} from '../../src/shared/tableIndexPatches';
const next={charset:'utf8mb4',collation:'utf8mb4_unicode_ci'};

it.each([
  ["VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'AbC' COMMENT '保留COLLATE字样'",'COLLATE utf8mb4_unicode_ci'],
  ["CHAR(20) CHARACTER SET utf8mb4 NULL DEFAULT ''",'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL'],
  ["VARCHAR(20) NOT NULL DEFAULT 'NULL' COMMENT '😀引号COLLATE'",'VARCHAR(20) COLLATE utf8mb4_unicode_ci NOT NULL'],
  ['VARCHAR(20)','VARCHAR(20) COLLATE utf8mb4_unicode_ci'],
  ['CHAR(20) NULL DEFAULT NULL','CHAR(20) COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL'],
])('只替换或插入确认的范围，保留原NULL/default/comment和旁列：%s',(definition,fragment)=>{
  const facts=collationFacts(definition),before=facts.base.source,plan=buildColumnCollationDefinition(facts,'note-ref',next),column=facts.indexes.model.definition.columns[1];
  expect(plan.definition).toContain(fragment);expect(plan.definition).toBe(column.raw.slice(0,plan.edit.range.start-column.range.start)+plan.edit.value+column.raw.slice(plan.edit.range.end-column.range.start));expect(plan.preserved.columns).toEqual([facts.indexes.model.definition.columns[0].raw]);expect(plan.preserved.tail).toBe(facts.indexes.model.definition.tail.raw);expect(plan.execution).toBe('blocked');expect(plan).not.toHaveProperty('sql');expect(facts.base.source).toBe(before);
});
it.each([next,{charset:'utf8mb4',collation:'utf8mb4_bin'},{charset:'latin1',collation:'latin1_swedish_ci'},{charset:'utf8mb4',collation:'utf8mb4_fake'},{charset:'utf8mb4',collation:'utf8mb4_bin;DROP_TABLE'}])('目录精确配对、同字符集和实际差异共同约束：%j',pair=>{const action=()=>buildColumnCollationDefinition(collationFacts(),'note-ref',pair);if(pair===next)expect(action().next).toEqual(next);else expect(action).toThrow();});
it.each([
  'INT DEFAULT 1','VARCHAR(20) DEFAULT (_utf8mb4\'AbC\')','VARCHAR(20) DEFAULT _utf8mb4\'AbC\'','VARCHAR(20) DEFAULT NULL COLLATE utf8mb4_bin','VARCHAR(20) GENERATED ALWAYS AS (\'x\') VIRTUAL','VARCHAR(20) INVISIBLE','VARCHAR(20) CHECK (LENGTH(note)>0)',"VARCHAR(20) /*!80000 INVISIBLE */ DEFAULT 'x'",
])('复杂默认、生成、隐藏、CHECK及可执行片段拒绝：%s',definition=>expect(()=>buildColumnCollationDefinition(collationFacts(definition),'note-ref',next)).toThrow());
it('已有表达式COLLATE fixture保持拒绝，不把表达式范围当独立列属性',()=>{const source=readFileSync('tests/fixtures/table-column-definitions/mysql-8.4.11-expression-collation.sql','utf8'),parsed=parseTableColumnDefinition(source,collationFacts().base.context),column=parsed.columns[1],facts=collationFacts(source.slice(column.type.range.start,column.range.end),'utf8mb4_unicode_ci');expect(()=>buildColumnCollationDefinition(facts,'note-ref',{charset:'utf8mb4',collation:'utf8mb4_bin'})).toThrow('表定义含未知');});
it('已有独立COLLATE fixture只改确认范围，不重写原文字量',()=>{const source=readFileSync('tests/fixtures/table-column-definitions/mysql-8.4.11-column-collation.sql','utf8'),parsed=parseTableColumnDefinition(source,collationFacts().base.context),column=parsed.columns[1],facts=collationFacts(source.slice(column.type.range.start,column.range.end));expect(buildColumnCollationDefinition(facts,'note-ref',next).definition).toContain("COLLATE utf8mb4_unicode_ci DEFAULT 'AbC'");});
it.each(['incoming','outgoing','partition','hidden','permission','indexed','function','digest','reference','extra','metadata','version']as const)('已读资格任一不足不得产生候选：%s',kind=>{
  const facts=collationFacts(),deps=facts.indexes.model.dependencies;
  if(kind==='incoming')deps.incomingCoverage={kind:'partial',reason:'permission'};
  if(kind==='outgoing')deps.outgoingComplete=false;
  if(kind==='partition')deps.partition={kind:'unknown',reason:'RAM'};
  if(kind==='hidden')deps.hiddenDependencies=[{indexRefs:[],reason:'RAM'}];
  if(kind==='permission')Object.assign(facts,{directAlterProven:false});
  if(kind==='indexed')(facts.indexes.model.indexes as Map<string,TrustedIndexDefinition>).get('pk-ref')!.definition!.keyParts[0].columnRef='note-ref';
  if(kind==='function')(facts.indexes.model.indexes as Map<string,TrustedIndexDefinition>).get('pk-ref')!.generated='unknown';
  if(kind==='digest')facts.catalog.digest='伪摘要';
  if(kind==='reference')(facts.references.columns as Map<string,string>).set('note-ref','missing');
  if(kind==='extra')facts.base.columnExtras![1][1]='INVISIBLE';
  if(kind==='metadata')facts.base.encodings[1].charset='latin1';
  if(kind==='version')facts.base.serverVersion='8.4.12';
  expect(()=>buildColumnCollationDefinition(facts,'note-ref',next)).toThrow();
});
it('FK列元组命中目标即拒绝，不能因非索引推定没有FK',()=>{const facts=collationFacts();facts.indexes.model.dependencies.foreignKeys=[{foreignKeyRef:'fk',direction:'incoming',targetColumnRefs:['note-ref'],support:{kind:'unknown',reason:'RAM'}}];expect(()=>buildColumnCollationDefinition(facts,'note-ref',next)).toThrow('外键');});
it('后核只豁免目标编码显示；正确范围也保持物理ID/算法未核验',()=>{
  const before=collationFacts(),plan=buildColumnCollationDefinition(before,'note-ref',next),after=collationFacts("VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT 'AbC' COMMENT '保留COLLATE字样'",next.collation),result=verifyColumnCollationChange(before,after,plan);expect(result.structuralMatch).toBe(true);expect(result.definitionVerified).toBe(false);expect(result.reasons).toContain('table-id-algorithm-unverified');Object.assign(after,{tableId:'任意新ID',algorithmVerified:true});expect(verifyColumnCollationChange(before,after,plan).definitionVerified).toBe(false);
});
it.each(['default','tail','side','encoding','extra','identity','mode','index','privilege','rawEncoding','tamperedPlan']as const)('后核不放宽目标其它属性、旁列、表尾和证据：%s',kind=>{
  const before=collationFacts(),plan=buildColumnCollationDefinition(before,'note-ref',next),after=collationFacts("VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT 'AbC' COMMENT '保留COLLATE字样'",next.collation);
  if(kind==='default'||kind==='tail'||kind==='side'||kind==='rawEncoding'){
    const source=after.base.source.replace(...(kind==='default'?["'AbC'","'changed'"]:kind==='tail'?['ENGINE=InnoDB','ENGINE=MyISAM']:kind==='side'?['`id` int','`id` bigint']:['COLLATE utf8mb4_unicode_ci','COLLATE utf8mb4_bin']) as [string,string]);after.base.source=source;after.indexes.source=source;after.indexes.model.definition.source=source;
  }
  if(kind==='encoding')after.base.encodings[0].collation='utf8mb4_bin';
  if(kind==='extra')after.base.columnExtras![0][1]='changed';
  if(kind==='identity')after.base.identity='other';
  if(kind==='mode')after.base.originalMode='ANSI_QUOTES';
  if(kind==='index')after.indexes.dependencyDigest='changed';
  if(kind==='privilege')Object.assign(after,{directAlterProven:false});
  if(kind==='tamperedPlan')Object.assign(plan,{definition:'恶意改写'});
  expect(verifyColumnCollationChange(before,after,plan).structuralMatch).toBe(false);expect(verifyColumnCollationChange(before,after,plan).definitionVerified).toBe(false);
});
