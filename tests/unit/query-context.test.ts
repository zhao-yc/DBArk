import {describe,it,expect} from 'vitest';
import {queryConnectionDatabase,queryDatabaseFromSession,queryDatabasePatch,resolveQueryDatabase} from '../../src/shared/queryContext';
import {validateCommand} from '../../src/shared/validation';
import {resolveCompletionContext} from '../../src/renderer/completionContext';

describe('查询数据库上下文的保存与重开',()=>{
  it('确认库、确认无库、未知均覆盖旧标签和连接默认库',()=>{
    for(const context of[{state:'known',database:'实际库'},{state:'known',database:null},{state:'unknown'}]as const){
      const resolved=resolveQueryDatabase('旧标签库',context,'连接配置库');expect(resolved).toEqual(context);expect(resolved).not.toBe(context);
      const patch=queryDatabasePatch(resolved);expect(resolveQueryDatabase(patch.database,patch.databaseContext,'连接配置库')).toEqual(context);
    }
    expect(queryConnectionDatabase({state:'known',database:null})).toBeNull();
    expect(()=>queryConnectionDatabase({state:'unknown'})).toThrow('先选择重连数据库');
  });
  it('旧草稿保留初始库兼容，但只在没有显式上下文时使用连接默认库',()=>{
    expect(resolveQueryDatabase('初始库',undefined,'配置库')).toEqual({state:'known',database:'初始库'});
    expect(resolveQueryDatabase(undefined,undefined,'配置库')).toEqual({state:'known',database:'配置库'});
    expect(resolveQueryDatabase()).toEqual({state:'known',database:null});
  });
  it('繁忙、断线、缺失或未知缓存不能成为可自动恢复的默认库',()=>{
    const known={databaseKnown:true,database:'实际库',broken:false,busy:false};
    expect(queryDatabaseFromSession(known)).toEqual({state:'known',database:'实际库'});
    expect(queryDatabaseFromSession({...known,database:null})).toEqual({state:'known',database:null});
    for(const state of[undefined,{...known,busy:true},{...known,broken:true},{...known,databaseKnown:false},{...known,database:undefined}])expect(queryDatabaseFromSession(state)).toEqual({state:'unknown'});
  });
  it('未知草稿补全保留状态提示与显式库来源，不能采用保存记录遗留的旧库',()=>{
    expect(resolveCompletionContext('旧库',undefined,true)).toEqual({database:undefined,mode:{},databaseUnknown:true,available:true});
  });
  it('IPC允许显式空库，拒绝形似已知的缺失状态和客户端注入执行快照',()=>{
    expect(validateCommand('sessions.open',{connectionId:'c',database:null})).toEqual({connectionId:'c',database:null});
    const query={id:'q',name:'保存查询',connectionId:'c',sql:'SELECT 1',updatedAt:'now'};
    for(const databaseContext of[{state:'known',database:'库'},{state:'known',database:null},{state:'unknown'}])expect(()=>validateCommand('queries.save',{...query,databaseContext})).not.toThrow();
    for(const databaseContext of[{state:'known'},{state:'unknown',database:'旧库'},{state:'known',database:'a\0b'},{state:'known',database:''},{state:'future'}])expect(()=>validateCommand('queries.save',{...query,databaseContext})).toThrow();
    expect(()=>validateCommand('query.execute',{sessionId:'s',taskId:'t',sql:'SELECT 1',maxRows:10,executionDatabase:{state:'known',database:'伪造库'}})).toThrow();
  });
});
