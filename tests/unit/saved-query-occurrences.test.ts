import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {compileSavedQueryPattern,matchSavedQueryRecord} from '../../src/main/savedQuerySearchMatch';
import {savedQuerySearchLimits,type SavedQuerySearchInput} from '../../src/shared/savedQuerySearch';

/** 受控文字/表达式仅验证生产Worker内纯函数，不执行SQL或接受外来正则。 */
function match(sql:string,text:string,mode:SavedQuerySearchInput['pattern']['mode']='contains',caseSensitive=false){
 const compiled=compileSavedQueryPattern({taskId:randomUUID(),scope:{kind:'all'},database:{kind:'all'},fields:['sql'],pattern:{mode,text,caseSensitive},maxResults:1000,onError:'stop'});
 return matchSavedQueryRecord('q',JSON.stringify({id:'q',name:'受控SQL',sql,updatedAt:'2026-10-16'}),compiled);
}
describe('保存查询全文的有界非重叠命中',()=>{
 it('普通文字完整转义，精确原文不经过大小写长度转换',()=>{
  expect(match('a.b x a.b','a.b')?.sqlOccurrences).toEqual({ranges:[{offset:0,length:3},{offset:6,length:3}],limitReached:false});
  expect(match('ſSſ','s')?.sqlOccurrences?.ranges).toEqual([{offset:0,length:1},{offset:1,length:1},{offset:2,length:1}]);
  expect(match('A a A','A','contains',true)?.sqlOccurrences?.ranges).toEqual([{offset:0,length:1},{offset:4,length:1}]);
 });
 it('四种原匹配语义保留，whole不能把尾部换行忽略为相等',()=>{
  expect(match('foo foo','foo')?.sqlOccurrences?.ranges).toHaveLength(2);
  expect(match('foo foo','foo','prefix')?.sqlOccurrences?.ranges).toEqual([{offset:0,length:3}]);
  expect(match('foo foo','foo foo','whole')?.sqlOccurrences?.ranges).toEqual([{offset:0,length:7}]);
  expect(match('foo\n','foo','whole')).toBeUndefined();
  expect(match('foo foo','f.o','regexp')?.sqlOccurrences?.ranges).toHaveLength(2);
  expect(match('aaaa','aa')?.sqlOccurrences?.ranges).toEqual([{offset:0,length:2},{offset:2,length:2}]);
 });
 it('CRLF和代理对保持UTF16原始跨度，预览首处行列不变',()=>{
  const hit=match('😀\r\n锚😀锚','锚')!;
  expect(hit.matches[0]).toMatchObject({line:2,column:1,offset:4,length:1});
  expect(hit.sqlOccurrences?.ranges).toEqual([{offset:4,length:1},{offset:7,length:1}]);
 });
 it('Unicode正则的零宽命中逐码点推进，包含正文末尾且不拆代理对',()=>{
  expect(match('😀x😀','(?:)','regexp')?.sqlOccurrences).toEqual({ranges:[{offset:0,length:0},{offset:2,length:0},{offset:3,length:0},{offset:5,length:0}],limitReached:false});
  expect(match('','', 'whole')?.sqlOccurrences).toEqual({ranges:[{offset:0,length:0}],limitReached:false});
 });
 it('最多200处，精确达到上限仍可声明完整，额外命中明确未全部列出',()=>{
  const limit=savedQuerySearchLimits.sqlMatches;
  expect(match('x'.repeat(limit),'x')?.sqlOccurrences).toMatchObject({limitReached:false,ranges:Array.from({length:limit},(_,offset)=>({offset,length:1}))});
  const capped=match('x'.repeat(1_000_000),'x')!;
  expect(capped.sqlOccurrences?.ranges).toHaveLength(limit);expect(capped.sqlOccurrences?.limitReached).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(capped))).toBeLessThan(16*1024);expect('sql' in capped.query).toBe(false);
 });
 it('仅名称命中不会伪造SQL高亮位置',()=>{
  const input:SavedQuerySearchInput={taskId:randomUUID(),scope:{kind:'all'},database:{kind:'all'},fields:['name','sql'],pattern:{mode:'contains',text:'名称命中',caseSensitive:false},maxResults:10,onError:'stop'};
  const hit=matchSavedQueryRecord('q',JSON.stringify({id:'q',name:'名称命中',sql:'SELECT 1',updatedAt:''}),compileSavedQueryPattern(input))!;
  expect(hit.matches.map(item=>item.field)).toEqual(['name']);expect(hit.sqlOccurrences).toBeUndefined();
 });
});
