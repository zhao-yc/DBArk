import {describe,it,expect,vi} from 'vitest';
import {SessionCompletionDirectory} from '../../src/renderer/sessionCompletionDirectory';
import {SessionObjects} from '../../src/engine/sessionObjects';
describe('临时对象覆盖独立永久补全目录',()=>{
  it('命中临时列不读取同名永久字段，未知时也不降级',async()=>{
    const c=new SessionObjects(0);c.confirm('db','subject',[{name:'temp_field',visible:true}]);const load=vi.fn(async()=>({entries:[{name:'wrong_permanent',kind:'column' as const}],incomplete:false}));let directory=new SessionCompletionDirectory({load},async query=>c.completion(query),c.revision);
    expect((await directory.load({kind:'columns',database:'db',table:'subject',prefix:''})).entries.map(c=>c.name)).toEqual(['temp_field']);expect(load).not.toHaveBeenCalled();c.invalidate();directory=new SessionCompletionDirectory({load},async query=>c.completion(query),c.revision);expect((await directory.load({kind:'columns',database:'db',table:'subject',prefix:''})).entries).toEqual([]);expect(load).not.toHaveBeenCalled();
  });
  it('对象列表按服务器大小写去重，保留其它永久表并给出会话来源',async()=>{
    const c=new SessionObjects(1);c.confirm('db','subject',[{name:'temp_field',visible:true}]);const load=vi.fn(async()=>({entries:[{name:'SUBJECT',kind:'table' as const},{name:'other',kind:'table' as const}],incomplete:false})),directory=new SessionCompletionDirectory({load},async query=>c.completion(query),c.revision);const result=await directory.load({kind:'objects',objectKind:'relation',database:'db',prefix:''});expect(result.entries.map(c=>c.name)).toEqual(['subject','other']);expect(result.entries[0].sessionObject).toBe('temporary');
  });
  it('目录修订变化拒绝旧模型，不换成永久源重试',async()=>{const c=new SessionObjects(0),revision=c.revision,load=vi.fn();c.confirm('db','subject',[]);const directory=new SessionCompletionDirectory({load},async query=>c.completion(query),revision);await expect(directory.load({kind:'columns',database:'db',table:'subject',prefix:''})).rejects.toThrow('已变化');expect(load).not.toHaveBeenCalled();});
});
