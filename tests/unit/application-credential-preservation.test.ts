import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { tlsCredentialMessages } from '../../src/shared/tlsCredentials';

const source = readFileSync(new URL('../../src/main/storage.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('storage.ts', source, ts.ScriptTarget.Latest, true);
const store = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'LocalStore') as ts.ClassDeclaration;
const names = ['mutate','readSecret','putSecret'];
const methods = names.map(name => store.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(tree) === name)!.getText(tree)).join('\n');

/** 只执行原私有方法；SQLite/磁盘/系统保护器均为RAM端口，不加载LocalStore或SQL.js。 */
function fixture(available = true) {
  const database = (entries: [string,string][] = []) => {
    const values = new Map(entries), released = vi.fn(), closed = vi.fn();
    return { values, released, closed,
      export: () => Buffer.from(JSON.stringify([...values])), close: closed,
      run(sql: string, params?: string[]) {
        if (['BEGIN','COMMIT','ROLLBACK'].includes(sql)) return;
        const key=params![0]+'\0'+params![1];
        if(sql.startsWith('DELETE FROM secrets'))values.delete(key);else if(sql==='INSERT INTO secrets VALUES (?,?,?)')values.set(key,params![2]);else throw Error('禁止其它SQL端口');
      },
      prepare(sql: string) {
        if(sql!=='SELECT value FROM secrets WHERE connection_id=? AND name=?')throw Error('禁止其它只读端口');
        let key='';return{bind(params:string[]){key=params[0]+'\0'+params[1];},step:()=>values.has(key),get:()=>[values.get(key)],free:released};
      },
    };
  };
  const protector = { available:vi.fn(()=>available),encrypt:vi.fn((_value:string)=>'RAM新密文'),decrypt:vi.fn((_value:string)=>'RAM原秘密') }, flush=vi.fn(), reopen=vi.fn((snapshot:Uint8Array)=>database(JSON.parse(Buffer.from(snapshot).toString())));
  const exports:any={};
  const code='exports.Store=class {constructor(db,protector,reopen,flush){this.db=db;this.protector=protector;this.reopen=reopen;this.flush=flush;this.volatileSecrets=new Map();}'+methods+'};';
  runInNewContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,Map,Error,tlsCredentialMessages});
  const original=database(), value=new exports.Store(original,protector,reopen,flush);
  return { value,original,protector,flush,reopen };
}
const slots=['password','sshPassword','sshPassphrase','tlsPassphrase'];

it('无秘密或已有volatile秘密不进行任何系统能力/解密调用',()=>{
  const f=fixture();expect(f.value.readSecret('连接','password')).toBeUndefined();f.value.volatileSecrets.set('连接\0password','仅内存');expect(f.value.readSecret('连接','password')).toBe('仅内存');expect(f.protector.available).not.toHaveBeenCalled();expect(f.protector.decrypt).not.toHaveBeenCalled();expect(f.original.released).toHaveBeenCalledOnce();
});
it.each(slots)('%s真实可用才加密，读取原密文真实解密；没有读取UI状态',name=>{
  const f=fixture();f.value.mutate(()=>f.value.putSecret('连接',name,'RAM秘密',true));expect(f.original.values.get('连接\0'+name)).toBe('RAM新密文');expect(f.value.volatileSecrets.has('连接\0'+name)).toBe(false);expect(f.protector.encrypt).toHaveBeenCalledExactlyOnceWith('RAM秘密');
  expect(f.value.readSecret('连接',name)).toBe('RAM原秘密');expect(f.protector.decrypt).toHaveBeenCalledExactlyOnceWith('RAM新密文');expect(f.protector.available).toHaveBeenCalledTimes(2);
});
it.each(slots)('%s真实不可用时仍只在内存，持久槽读取明确失败而不删除',name=>{
  const f=fixture(false);f.value.putSecret('连接',name,'仅内存秘密',true);expect(f.original.values.size).toBe(0);expect(f.value.volatileSecrets.get('连接\0'+name)).toBe('仅内存秘密');expect(f.protector.encrypt).not.toHaveBeenCalled();
  f.value.volatileSecrets.clear();f.original.values.set('连接\0'+name,'原密文');expect(()=>f.value.readSecret('连接',name)).toThrow('系统凭据加密不可用');expect(f.original.values.get('连接\0'+name)).toBe('原密文');expect(f.protector.decrypt).not.toHaveBeenCalled();
});
it.each(slots)('%s缺省保留原秘密，空串清除，关闭记住密码仍仅内存',name=>{
  const f=fixture();f.original.values.set('连接\0'+name,'原密文');f.value.putSecret('连接',name,undefined,true);expect(f.protector.decrypt).toHaveBeenCalledWith('原密文');expect(f.protector.encrypt).toHaveBeenCalledWith('RAM原秘密');
  f.value.putSecret('连接',name,'改为内存',false);expect(f.original.values.size).toBe(0);expect(f.value.volatileSecrets.get('连接\0'+name)).toBe('改为内存');
  const calls=f.protector.available.mock.calls.length;f.value.putSecret('连接',name,'',true);expect(f.original.values.size).toBe(0);expect(f.value.volatileSecrets.size).toBe(0);expect(f.protector.available).toHaveBeenCalledTimes(calls);
});
it.each(slots)('%s原加密或写盘错误回滚原SQLite快照与volatile秘密',name=>{
  for(const stage of ['encrypt','flush']){
    const f=fixture();f.original.values.set('连接\0'+name,'原密文');f.value.volatileSecrets.set('另一个槽','原内存');
    if(stage==='encrypt')f.protector.encrypt.mockImplementation(()=>{throw Error('原加密错误');});else f.flush.mockImplementation(()=>{throw Error('原写盘错误');});
    expect(()=>f.value.mutate(()=>{f.value.volatileSecrets.set('另一个槽','未提交内存');f.value.putSecret('连接',name,'未提交秘密',true);})).toThrow('修改未保存');
    expect(f.value.db.values.get('连接\0'+name)).toBe('原密文');expect(f.value.volatileSecrets.get('另一个槽')).toBe('原内存');expect(f.original.closed).toHaveBeenCalledOnce();expect(f.reopen).toHaveBeenCalledOnce();
  }
});
it('原密文无法解密仍明确错误并释放原语句，不借unknown/假明文降级',()=>{
  const f=fixture();f.original.values.set('连接\0password','原密文');f.protector.decrypt.mockImplementation(()=>{throw Error('原解密错误');});expect(()=>f.value.readSecret('连接','password')).toThrow('无法解密已保存的凭据');expect(f.original.values.get('连接\0password')).toBe('原密文');expect(f.original.released).toHaveBeenCalledOnce();
});
