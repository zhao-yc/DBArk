import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { collationFacts } from '../fixtures/column-collation-facts';
import { buildColumnCollationExecutionPlan as build, verifyColumnCollationExecution as verify } from '../../src/engine/tableColumnCollationExecution';
import { buildColumnCollationDefinition, verifyColumnCollationChange } from '../../src/engine/tableColumnCollationSql';
import { columnCollationAcknowledgements } from '../../src/shared/tableColumnPatches';
import type { ColumnCollationFacts } from '../../src/engine/tableColumnCollationRead';
import type { ColumnCollationPhysicalResult } from '../../src/engine/tableColumnCollationPhysicalRead';
type Physical=Extract<ColumnCollationPhysicalResult,{status:'observed'}>;
const next={charset:'utf8mb4',collation:'utf8mb4_unicode_ci'};
/** 合成物理结果仅测试私有纯函数；不代表真实reader或数据库观测通过。 */
function physical(facts:ColumnCollationFacts,id='9007199254740993'):Physical{return{status:'observed',tableId:id,target:{...facts.target},serverIdentity:facts.base.identity,mapping:{dialect:'mysql',version:'8.4.11',compileOs:'linux',compileOsReported:'Linux',lowerCaseTableNames:0,tableType:'BASE TABLE',engine:'InnoDB',partitionName:null,catalog:'information_schema.INNODB_TABLES',nativeName:facts.target.database+'/'+facts.target.table},bytes:1024}}
/** 后核原文独立给出，不能用计划SQL生成一个会必然成功的假回包。 */
function fixture(){const before=collationFacts(),after=collationFacts("VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'AbC' COMMENT '保留COLLATE字样'",next.collation),pre=physical(before),post=physical(after,'18446744073709551615');return{before,after,pre,post,plan:build(before,pre,'note-ref',next)}}

describe('单列排序规则私有执行计划与定义范围后核',()=>{
  it('只生成一条qualified完整MODIFY，4ACK齐全，原v1候选/后核保持blocked/false',()=>{
    const f=fixture(),candidate=buildColumnCollationDefinition(f.before,'note-ref',next);
    expect(f.plan.sql).toBe('ALTER TABLE `ram_db`.`subject` MODIFY COLUMN '+candidate.definition);expect(f.plan.sql).not.toMatch(/\b(?:ALGORITHM|LOCK|FIRST|AFTER)\b/);
    expect(f.plan.candidate).toEqual(candidate);expect(f.plan.requiredAcknowledgements).toEqual(['ddl-implicit-commit','external-ddl-window',...columnCollationAcknowledgements]);
    expect(f.plan.originalSourceDigest).toBe(createHash('sha256').update(f.before.base.source).digest('hex'));expect(f.plan.warnings.join('')).toContain('不证明数据');
    expect(f.plan.candidate.execution).toBe('blocked');expect(verifyColumnCollationChange(f.before,f.after,candidate)).toMatchObject({definitionVerified:false,structuralMatch:true});
    expect(f.before.execution.reasons).toEqual(['table-id-algorithm-unverified','external-dependencies-and-visibility-unverified']);
  });
  it('新ID且定义正确可以通过；同ID只说明没有观测到ID变化，不代替定义核对',()=>{
    const f=fixture();expect(verify(f.before,f.after,f.pre,f.post,f.plan)).toEqual({definitionVerified:true,tableIdChanged:true,reasons:[]});
    expect(verify(f.before,f.after,f.pre,physical(f.after,f.pre.tableId),structuredClone(f.plan))).toEqual({definitionVerified:true,tableIdChanged:false,reasons:[]});
  });
  it('同ID定义错误失败；新ID定义错误同样失败，不能把重建本身当定义成功',()=>{
    const f=fixture();for(const id of [f.pre.tableId,f.post.tableId]){const wrong=collationFacts("VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'wrong'",next.collation);expect(verify(f.before,wrong,f.pre,physical(wrong,id),f.plan)).toMatchObject({definitionVerified:false,tableIdChanged:id!==f.pre.tableId});}
  });
  it('相邻超安全整数ID按原十进制文本比较，不能转Number后误报相同',()=>{
    const f=fixture();Object.assign(f.post,{tableId:'9007199254740992'});expect(verify(f.before,f.after,f.pre,f.post,f.plan)).toEqual({definitionVerified:true,tableIdChanged:true,reasons:[]});
  });
  it('执行前物理ID必须仍是计划绑定的原值，即使其它映射/定义相同也不能换租约',()=>{
    const f=fixture(),other={...f.pre,tableId:'2'};expect(verify(f.before,f.after,other,f.post,f.plan).definitionVerified).toBe(false);
  });
  it('保留独立完整原事实及原始模式，输入后改不污染计划；Map改写也被完整重建拒绝',()=>{
    const f=fixture();expect(f.plan.beforeFacts).not.toBe(f.before);expect(f.plan.beforePhysical).not.toBe(f.pre);expect(f.plan.beforeFacts.references.columns).not.toBe(f.before.references.columns);
    f.before.base.source='被改写';expect(f.plan.beforeFacts.base.source).not.toBe(f.before.base.source);expect(verify(f.before,f.after,f.pre,f.post,f.plan).definitionVerified).toBe(false);
    const fresh=fixture();(fresh.plan.beforeFacts.references.columns as Map<string,string>).set('note-ref','wrong');expect(verify(fresh.before,fresh.after,fresh.pre,fresh.post,fresh.plan).definitionVerified).toBe(false);
    const mode=collationFacts();mode.base.originalMode='ANSI';const plan=build(mode,physical(mode),'note-ref',next);expect(plan.beforeFacts.base.originalMode).toBe('ANSI');expect(verify(mode,fresh.after,physical(mode),fresh.post,plan).definitionVerified).toBe(true);
  });
  it.each(['0','01','-1','1.0','1e4','18446744073709551616',9007199254740992,undefined])('物理ID必须精确非零uint64十进制文本：%j',id=>{
    const facts=collationFacts(),pre=physical(facts);Object.assign(pre,{tableId:id});expect(()=>build(facts,pre,'note-ref',next)).toThrow();
  });
  it.each([
    ['dialect','mariadb'],['version','8.4.12'],['compileOs','windows'],['compileOsReported','Win64'],['lowerCaseTableNames',1],['lowerCaseTableNames','0'],['lowerCaseTableNames',-0],['tableType','VIEW'],['engine','MyISAM'],['partitionName','p0'],['catalog','其它目录'],['nativeName','ram_db/other'],
  ])('mapping %s=%j不能冒充实际支持映射',(key,value)=>{
    const facts=collationFacts(),pre=physical(facts);Object.assign(pre.mapping,{[key]:value});expect(()=>build(facts,pre,'note-ref',next)).toThrow();
  });
  it.each(['unavailable','server','target','extra','budget','index-server','index-target','mode','references','v1-ready','permission'])('非observed/归属或核心证据%s不足时不生成可执行计划',fault=>{
    const facts=collationFacts(),pre=physical(facts);
    if(fault==='unavailable')Object.assign(pre,{status:'unavailable',reason:'missing-table-id'});if(fault==='server')Object.assign(pre,{serverIdentity:'其它服务器'});if(fault==='target')Object.assign(pre.target,{connectionId:'other'});if(fault==='extra')Object.assign(pre.mapping,{algorithmVerified:true});if(fault==='budget')Object.assign(pre,{bytes:-1});
    if(fault==='index-server')facts.indexes.identity='其它服务器';if(fault==='index-target')facts.indexes.options!.database='other';if(fault==='mode')Object.assign(facts.base.context.mode,{ansiQuotes:'false'});if(fault==='references')(facts.references.columns as Map<string,string>).delete('id-ref');if(fault==='v1-ready')Object.assign(facts,{execution:{kind:'ready',reasons:[]}});if(fault==='permission')Object.assign(facts,{directAlterProven:false});
    expect(()=>build(facts,pre,'note-ref',next)).toThrow();
  });
  it.each(['unavailable','target','server','mapping','reported-case','id','permission','sql','ack','warning','candidate','range','sourceDigest','savedFacts','savedPhysical','extra-plan'])('专用后核%s变化不能通过完整计划/身份核对',fault=>{
    const f=fixture();let plan=structuredClone(f.plan),post:any=structuredClone(f.post);
    if(fault==='unavailable')post={status:'unavailable',reason:'missing-table-id',stage:'identity',bytes:0};if(fault==='target')post.target.table='other';if(fault==='server')post.serverIdentity='other';if(fault==='mapping')post.mapping.catalog='other';if(fault==='reported-case')post.mapping.compileOsReported='linux';if(fault==='id')post.tableId=100;if(fault==='permission')Object.assign(f.after,{directAlterProven:false});
    if(fault==='sql')Object.assign(plan,{sql:plan.sql+', DROP COLUMN `id`'});if(fault==='ack')plan.requiredAcknowledgements.pop();if(fault==='warning')plan.warnings=[];if(fault==='candidate')Object.assign(plan.candidate,{definition:'`note` int'});if(fault==='range')Object.assign(plan.candidate.edit.range,{start:0});if(fault==='sourceDigest')Object.assign(plan,{originalSourceDigest:'a'.repeat(64)});if(fault==='savedFacts')plan.beforeFacts.base.source='假原文';if(fault==='savedPhysical')Object.assign(plan.beforePhysical,{tableId:'2'});if(fault==='extra-plan')Object.assign(plan,{algorithmVerified:true});
    expect(verify(f.before,f.after,f.pre,post,plan).definitionVerified).toBe(false);
  });
  it('不透明表达式/外键/索引等核心硬门不由物理结果或新布尔绕过',()=>{
    const facts=collationFacts();facts.indexes.model.dependencies.foreignKeys=[{foreignKeyRef:'fk',direction:'incoming',targetColumnRefs:['note-ref'],support:{kind:'unknown',reason:'RAM'}}];expect(()=>build(facts,physical(facts),'note-ref',next)).toThrow('外键');
    const extra:any=collationFacts();extra.algorithmVerified=true;extra.externalVisibilityProven=true;expect(()=>build(extra,physical(extra),'note-ref',next)).toThrow();
  });
  it('getter/toJSON/Proxy及循环证据不执行，计划和事实不可借反射副作用伪装',()=>{
    const facts=collationFacts();let reads=0;const pre=physical(facts);Object.defineProperty(pre.mapping,'engine',{enumerable:true,get(){reads++;return'InnoDB'}});expect(()=>build(facts,pre,'note-ref',next)).toThrow();expect(reads).toBe(0);
    const proxy=new Proxy(physical(facts),{get(){reads++;throw Error('不得执行')}});expect(()=>build(facts,proxy,'note-ref',next)).toThrow();expect(reads).toBe(0);
    const json:any=physical(facts);json.toJSON=()=>{reads++;return physical(facts)};expect(()=>build(facts,json,'note-ref',next)).toThrow();expect(reads).toBe(0);
    const loop:any=collationFacts();loop.base.loop=loop;expect(()=>build(loop,physical(loop),'note-ref',next)).toThrow();
  });
});
