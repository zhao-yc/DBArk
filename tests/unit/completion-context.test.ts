import {describe,it,expect} from 'vitest';
import {resolveCompletionContext} from '../../src/renderer/completionContext';
import {completionSuggestions} from '../../src/renderer/completionSuggestions';
import type {CompletionSessionState} from '../../src/shared/sqlCompletion';
const state=(update:Partial<CompletionSessionState>={}):CompletionSessionState=>({database:'B',databaseKnown:true,ansiQuotes:true,noBackslashEscapes:false,broken:false,busy:false,...update});
describe('编辑器使用实际会话补全上下文',()=>{
  it('没有查询会话时采用标签初始库，模式仍未知',()=>{expect(resolveCompletionContext('A')).toEqual({database:'A',mode:{},databaseUnknown:false,available:true});});
  it('有会话时B覆盖标签A，并传递已知模式',()=>{expect(resolveCompletionContext('A',state())).toEqual({database:'B',mode:{ansiQuotes:true,noBackslashEscapes:false},databaseUnknown:false,available:true});});
  it('确认无默认库与未知默认库均不能退回旧标签A',()=>{for(const value of[state({database:null}),state({database:undefined,databaseKnown:false})])expect(resolveCompletionContext('A',value).database).toBeUndefined();expect(resolveCompletionContext('A',state({database:null})).databaseUnknown).toBe(false);expect(resolveCompletionContext('A',state({database:undefined,databaseKnown:false})).databaseUnknown).toBe(true);});
  it.each(['busy','broken'] as const)('%s时不能交付模式和旧库',key=>{const result=resolveCompletionContext('A',state({[key]:true}));expect(result.available).toBe(false);expect(result.database).toBeUndefined();expect(result.mode).toEqual({});});
  it('默认库未知仍允许显式库来源，未限定来源不读取标签旧库',async()=>{const context=resolveCompletionContext('A',state({database:undefined,databaseKnown:false})),calls:unknown[]=[],directory={load:async(input:unknown)=>{calls.push(input);return{entries:[],incomplete:false};}},analysis={status:'ready' as const,target:{start:0,end:0,prefix:'',qualifiers:['u'],quoted:false},syntax:['column' as const],keywords:[],relations:[{name:'u',source:'table' as const,aliased:true,columns:[],catalogs:[{table:'subject'}],incomplete:false}],localRelations:[],columnMode:'expression' as const,incomplete:false};await completionSuggestions(analysis,context.database,directory);expect(calls).toEqual([]);await completionSuggestions({...analysis,relations:[{...analysis.relations[0],catalogs:[{database:'B',table:'subject'}]}]},context.database,directory);expect(calls).toEqual([{kind:'columns',database:'B',table:'subject',prefix:''}]);});
});
