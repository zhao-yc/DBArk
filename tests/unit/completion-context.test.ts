import {describe,it,expect} from 'vitest';
import {resolveCompletionContext,completionContextCapabilities} from '../../src/renderer/completionContext';
import {completionSuggestions} from '../../src/renderer/completionSuggestions';
import type {CompletionSessionState} from '../../src/shared/sqlCompletion';
const state=(update:Partial<CompletionSessionState>={}):CompletionSessionState=>({database:'B',databaseKnown:true,ansiQuotes:true,noBackslashEscapes:false,broken:false,busy:false,...update});
describe('编辑器使用实际会话补全上下文',()=>{
  it('无会话草稿只用已经取得的方言版本，未知不可推定支持，MariaDB窗口与LATERAL分开判断',()=>{
    expect(completionContextCapabilities()).toEqual({lateralDerivedTables:false,windowFunctions:false,insertRowAliases:false});
    expect(completionContextCapabilities(undefined,{dialect:'mysql',version:'8.4.11'})).toEqual({lateralDerivedTables:true,windowFunctions:true,insertRowAliases:true});
    expect(completionContextCapabilities(undefined,{dialect:'mysql',version:'5.7.44'})).toEqual({lateralDerivedTables:false,windowFunctions:false,insertRowAliases:false});
    expect(completionContextCapabilities(undefined,{dialect:'mariadb',version:'11.4.13-MariaDB'})).toEqual({lateralDerivedTables:false,windowFunctions:true,insertRowAliases:false});
  });
  it('已有会话的旧版或未知版本不借用已打开连接的MySQL8能力',()=>{
    const opened={dialect:'mysql' as const,version:'8.4.11'};
    for(const update of[{}, {dialect:'mysql' as const,serverVersion:'5.7.44'}, {dialect:'mariadb' as const,serverVersion:'11.4.13-MariaDB'}])expect(completionContextCapabilities(state(update),opened)).toEqual({lateralDerivedTables:false,windowFunctions:update.dialect==='mariadb',insertRowAliases:false});
    expect(completionContextCapabilities(state({dialect:'mysql',serverVersion:'8.0.46'}),{dialect:'mysql',version:'5.7.44'})).toEqual({lateralDerivedTables:true,windowFunctions:true,insertRowAliases:true});
  });
  it.each(['busy','broken']as const)('%s会话隐藏能力，缓存中再新的版本也不能替代',key=>{
    expect(completionContextCapabilities(state({dialect:'mysql',serverVersion:'8.4.11',[key]:true}),{dialect:'mysql',version:'8.4.11'})).toEqual({lateralDerivedTables:false,windowFunctions:false,insertRowAliases:false});
  });
  it('没有查询会话时采用标签初始库，模式仍未知',()=>{expect(resolveCompletionContext('A')).toEqual({database:'A',mode:{},databaseUnknown:false,available:true});});
  it('有会话时B覆盖标签A，并传递已知模式',()=>{expect(resolveCompletionContext('A',state())).toEqual({database:'B',mode:{ansiQuotes:true,noBackslashEscapes:false},databaseUnknown:false,available:true});});
  it('确认无默认库与未知默认库均不能退回旧标签A',()=>{for(const value of[state({database:null}),state({database:undefined,databaseKnown:false})])expect(resolveCompletionContext('A',value).database).toBeUndefined();expect(resolveCompletionContext('A',state({database:null})).databaseUnknown).toBe(false);expect(resolveCompletionContext('A',state({database:undefined,databaseKnown:false})).databaseUnknown).toBe(true);});
  it.each(['busy','broken'] as const)('%s时不能交付模式和旧库',key=>{const result=resolveCompletionContext('A',state({[key]:true}));expect(result.available).toBe(false);expect(result.database).toBeUndefined();expect(result.mode).toEqual({});});
  it('默认库未知仍允许显式库来源，未限定来源不读取标签旧库',async()=>{const context=resolveCompletionContext('A',state({database:undefined,databaseKnown:false})),calls:unknown[]=[],directory={load:async(input:unknown)=>{calls.push(input);return{entries:[],incomplete:false};}},analysis={status:'ready' as const,target:{start:0,end:0,prefix:'',qualifiers:['u'],quoted:false},syntax:['column' as const],keywords:[],relations:[{name:'u',source:'table' as const,aliased:true,columns:[],catalogs:[{table:'subject'}],incomplete:false}],localRelations:[],columnMode:'expression' as const,incomplete:false};await completionSuggestions(analysis,context.database,directory);expect(calls).toEqual([]);await completionSuggestions({...analysis,relations:[{...analysis.relations[0],catalogs:[{database:'B',table:'subject'}]}]},context.database,directory);expect(calls).toEqual([{kind:'columns',database:'B',table:'subject',prefix:''}]);});
});
