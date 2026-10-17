import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { LocalStore } from '../../src/main/storage';
import initSqlJs from 'sql.js';
import type { ConnectionProfile } from '../../src/shared/contracts';
const require = createRequire(import.meta.url);
const temporary: string[] = [];
const profile: ConnectionProfile = { id: 'test', name: '测试数据库', host: '127.0.0.1', port: 3306, user: 'test', group: '开发', color: '#abcdef', dialect: 'mysql', password: 'never-plaintext-123', rememberPassword: true };
const protector = { available: () => true, encrypt: (value: string) => Buffer.from(value).toString('base64'), decrypt: (value: string) => Buffer.from(value,'base64').toString() };
async function open(available = true) { const dir = mkdtempSync(join(tmpdir(), 'dbark-test-')); temporary.push(dir); const path = join(dir, 'test.sqlite'); return { path, store: await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), { ...protector, available: () => available }) }; }
afterEach(() => { for(const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
describe('配置与凭据持久化', () => {
  it('schema4原记录无损迁移至8，新上下文的空库和未知在重启后保持区分',async()=>{
    const {store,path}=await open();store.saveConnection(profile);const stamp=new Date().toISOString();
    store.saveQuery({id:'legacy',name:'旧查询',connectionId:profile.id,database:'初始库',sql:'SELECT 1',updatedAt:stamp});
    store.close();const SQL=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});const old=new SQL.Database(readFileSync(path));old.run('PRAGMA user_version=4');const oldQueries=old.exec('SELECT * FROM queries');writeFileSync(path,old.export());old.close();
    const upgraded=await LocalStore.open(path,require.resolve('sql.js/dist/sql-wasm.wasm'),protector);expect(upgraded.queries()[0]).toMatchObject({id:'legacy',database:'初始库'});expect(upgraded.resolveConnection(profile.id).password).toBe(profile.password);
    for(const [index,context]of([{state:'known',database:'真实库'},{state:'known',database:null},{state:'unknown'}]as const).entries()){
      upgraded.saveQuery({id:'q'+index,name:'上下文'+index,connectionId:profile.id,databaseContext:context,sql:'SELECT DATABASE()',updatedAt:stamp});
      upgraded.addHistory({id:'h'+index,connectionId:profile.id,databaseContext:context,sql:'SELECT DATABASE()',startedAt:stamp,elapsedMs:1,success:true});
    }
    upgraded.saveSettings({...upgraded.settings(),tabs:[{id:'draft',kind:'query',title:'待确认草稿',connectionId:profile.id,databaseContext:{state:'unknown'},sql:'INSERT INTO subject VALUES(1)'}]});upgraded.close();
    const persisted=new SQL.Database(readFileSync(path));expect(persisted.exec('PRAGMA user_version')[0].values[0][0]).toBe(8);expect(persisted.exec("SELECT * FROM queries WHERE id='legacy'")).toEqual(oldQueries);persisted.close();
    const restored=await LocalStore.open(path,require.resolve('sql.js/dist/sql-wasm.wasm'),protector);
    expect(restored.queries().find(item=>item.id==='q1')?.databaseContext).toEqual({state:'known',database:null});expect(restored.history().find(item=>item.id==='h2')?.databaseContext).toEqual({state:'unknown'});expect(restored.settings().tabs[0].databaseContext).toEqual({state:'unknown'});restored.close();
  });
  it('界面和SQLite均不包含明文密码，重启能恢复加密凭据', async () => {
    const { store, path } = await open(); const saved = store.saveConnection(profile);
    expect(saved.password).toBeUndefined(); expect(saved.hasPassword).toBe(true);
    expect(store.resolveConnection('test').password).toBe(profile.password);
    store.close(); expect(readFileSync(path).includes(Buffer.from(profile.password!))).toBe(false);
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.resolveConnection('test').password).toBe(profile.password); restored.close();
  });
  it('系统加密不可用时密码只存在当前会话', async () => {
    const { store, path } = await open(false); store.saveConnection(profile);
    expect(store.resolveConnection('test').password).toBe(profile.password); store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.connections()[0].hasPassword).toBe(false); expect(restored.resolveConnection('test').password).toBeUndefined(); restored.close();
  });
  it('编辑连接保留未重输密码，关闭记住密码会清除持久密文', async () => {
    const { store, path } = await open(); const saved = store.saveConnection(profile);
    store.saveConnection({ ...saved, name: '新的名字', rememberPassword: false });
    expect(store.resolveConnection('test').password).toBe(profile.password); store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.connections()[0].hasPassword).toBe(false); restored.close();
  });
  it('显式清除数据库和 SSH 凭据后，重启不恢复旧密码', async () => {
    const { store, path } = await open();
    const saved = store.saveConnection({ ...profile, ssh: { enabled: true, host: 'localhost', port: 22, user: 'test', password: 'ssh-test-secret', passphrase: 'key-test-secret' } });
    const cleared = store.saveConnection({ ...saved, password: '', ssh: { ...saved.ssh!, password: '', passphrase: '' } });
    expect(cleared.hasPassword).toBe(false); expect(cleared.ssh?.hasPassword).toBe(false); expect(cleared.ssh?.hasPassphrase).toBe(false);
    store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.resolveConnection('test').password).toBeUndefined(); expect(restored.resolveConnection('test').ssh?.password).toBeUndefined(); expect(restored.resolveConnection('test').ssh?.passphrase).toBeUndefined(); restored.close();
  });
  it('迁移可重复，退出中的任务不自动重放', async () => {
    const { store, path } = await open(); store.saveTask({ id: 'unfinished', kind: 'query.execute', status: 'running', progress: 10, message: '执行中', startedAt: new Date().toISOString() }); store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.tasks()[0].status).toBe('failed'); expect(restored.settings().theme).toBe('dark'); restored.close();
  });
  it('磁盘失败后内存及密码回退，后续保存不会偷偷提交失败修改', async () => {
    const { store, path } = await open(); const saved = store.saveConnection(profile);
    mkdirSync(`${path}.tmp`);
    expect(() => store.saveConnection({ ...saved, name: '失败的名字', password: 'failed-secret-change' })).toThrow('修改未保存');
    expect(store.connections()[0].name).toBe(profile.name); expect(store.resolveConnection(profile.id).password).toBe(profile.password);
    rmSync(`${path}.tmp`, { recursive: true });
    store.saveSettings({ ...store.settings(), theme: 'light' }); store.close();
    const restored = await LocalStore.open(path, require.resolve('sql.js/dist/sql-wasm.wasm'), protector);
    expect(restored.connections()[0].name).toBe(profile.name); expect(restored.resolveConnection(profile.id).password).toBe(profile.password); restored.close();
  });
});
