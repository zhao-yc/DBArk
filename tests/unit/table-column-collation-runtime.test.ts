import {expect,it} from 'vitest';
import {collationFacts} from '../fixtures/column-collation-facts';
import {buildColumnCollationDefinition as build,verifyColumnCollationChange as verify} from '../../src/engine/tableColumnCollationSql';
import {assertColumnCollationUnchanged} from '../../src/engine/tableColumnCollationRead';
const next={charset:'utf8mb4',collation:'utf8mb4_unicode_ci'},blocked=['table-id-algorithm-unverified','external-dependencies-and-visibility-unverified'];

/** 正常范围对照始终保留准备态，不以任意运行时标记授予执行或完整核验。 */
function pair(){const before=collationFacts(),plan=build(before,'note-ref',next),after=collationFacts("VARCHAR(20) COLLATE utf8mb4_unicode_ci DEFAULT 'AbC' COMMENT '保留COLLATE字样'",next.collation);return{before,plan,after};}
it('明确布尔的正常候选与范围核对仍成功，但没有可执行SQL或完整核验',()=>{const {before,after,plan}=pair(),result=verify(before,after,plan);expect(plan).toMatchObject({kind:'candidate-only',execution:'blocked'});expect(plan).not.toHaveProperty('sql');expect(result).toEqual({definitionVerified:false,structuralMatch:true,reasons:blocked});result.reasons.length=0;expect(verify(before,after,plan).reasons).toEqual(blocked);});

it.each(['directAlterProven','outgoingComplete','generated','hidden']as const)('必要事实%s缺失/非布尔均拒绝，不按真假性猜测',field=>{
  for(const value of ['false','true',0,1,undefined,null]){const facts:any=collationFacts(),owner=field==='directAlterProven'?facts:field==='outgoingComplete'?facts.indexes.model.dependencies:facts.indexes.model.columns.get('note-ref');owner[field]=value;expect(()=>build(facts,'note-ref',next)).toThrow();delete owner[field];expect(()=>build(facts,'note-ref',next)).toThrow();}
});
it.each(['charset','collation']as const)('配对%s访问器被拒绝且不执行',field=>{let calls=0;const value:any={...next};Object.defineProperty(value,field,{enumerable:true,get(){calls++;return next[field];}});expect(()=>build(collationFacts(),'note-ref',value)).toThrow();expect(calls).toBe(0);});
it('toJSON和额外字段均不执行，自定义原型与Proxy也在反射读取前拒绝',()=>{
  let calls=0;const value={...next,toJSON(){calls++;return next;}};expect(()=>build(collationFacts(),'note-ref',value)).toThrow();
  const inherited=Object.create({get charset(){calls++;return next.charset;}});inherited.collation=next.collation;expect(()=>build(collationFacts(),'note-ref',inherited)).toThrow();
  const proxy=new Proxy({...next},{get(target,key,receiver){calls++;return Reflect.get(target,key,receiver);},getOwnPropertyDescriptor(target,key){calls++;return Reflect.getOwnPropertyDescriptor(target,key);}});expect(()=>build(collationFacts(),'note-ref',proxy)).toThrow();expect(calls).toBe(0);
});
it('必要布尔事实的访问器也不能被当证明调用',()=>{for(const field of ['directAlterProven','generated']){let calls=0;const facts:any=collationFacts(),owner=field==='directAlterProven'?facts:facts.indexes.model.columns.get('note-ref');Object.defineProperty(owner,field,{enumerable:true,get(){calls++;return false;}});expect(()=>build(facts,'note-ref',next)).toThrow();expect(calls).toBe(0);}});

it.each([
  undefined,{kind:'ready',reasons:[]},{kind:'blocked',reasons:[]},{kind:'blocked',reasons:[blocked[0]]},{kind:'blocked',reasons:[...blocked,'额外原因']},{kind:'blocked',reasons:[...blocked].reverse()},
])('未知或篡改execution不能产生结构成功或吞掉固定原因：%j',gate=>{
  for(const side of ['before','after']as const){const state=pair();Object.assign(state[side],{execution:gate});const result=verify(state.before,state.after,state.plan);expect(result.definitionVerified).toBe(false);expect(result.structuralMatch).toBe(false);expect(result.reasons).toEqual(expect.arrayContaining(blocked));}
  const before=collationFacts(),after=collationFacts();Object.assign(before,{execution:gate});Object.assign(after,{execution:gate});expect(()=>assertColumnCollationUnchanged(before,after)).toThrow();
});
it('阻断原因访问器不执行，后核拒绝并使用内部固定原因',()=>{const state=pair();let calls=0;Object.defineProperty(state.after.execution,'reasons',{enumerable:true,get(){calls++;return[];}});const result=verify(state.before,state.after,state.plan);expect(calls).toBe(0);expect(result.structuralMatch).toBe(false);expect(result.reasons).toEqual(expect.arrayContaining(blocked));});
