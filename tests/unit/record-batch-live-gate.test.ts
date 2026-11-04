import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { bindRecordBatchLiveEnvironment, recordBatchLiveEnvironment } from '../e2e/record-batch-live-gate';

const mysql = () => ({ DBARK_RECORD_BATCH_LIVE: '1', DBARK_INTEGRATION_ENABLED: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '合成密码不连接', DBARK_TEST_DATABASE: 'dbark_batch_012345abcdef', DBARK_BATCH_OWNER: 'a'.repeat(32), DBARK_BATCH_VERSION: '8.4.11', DBARK_BATCH_HOSTNAME: 'test-container', DBARK_BATCH_UUID: 'abcdef01-1234-5678-9abc-0123456789ab', DBARK_BATCH_DIALECT: 'mysql' });
it('两种基线身份与准确随机库明确绑定，固定原生资源门不被命令行覆盖', () => {
  expect(recordBatchLiveEnvironment(mysql(), ['--workers=1', '--trace', 'off'], 'darwin')).toMatchObject({ dialect: 'mysql', port: 13384 });
  const { DBARK_BATCH_UUID: _, ...maria } = { ...mysql(), DBARK_BATCH_VERSION: '11.4.10-MariaDB-ubu2404', DBARK_TEST_PORT: '13311', DBARK_BATCH_DIALECT: 'mariadb' };
  expect(recordBatchLiveEnvironment(maria, [], 'win32')).toMatchObject({ dialect: 'mariadb', port: 13311 });
  expect(() => recordBatchLiveEnvironment({ ...maria, DBARK_TEST_PORT: '13384' }, [], 'darwin')).toThrow();
  expect(() => recordBatchLiveEnvironment({ ...mysql(), DBARK_TEST_PORT: '13311' }, [], 'darwin')).toThrow();
});
it.each(['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'SSH_AUTH_SOCK', 'PWDEBUG', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_SSH_KEY', 'MYSQL_PASSWORD', 'PGPASSWORD'])('危险外部字段%s在声明阶段拒绝，不泄露其值', field => {
  expect(() => recordBatchLiveEnvironment({ ...mysql(), [field]: '不得输出的合成值' }, [], 'darwin')).toThrow(/实库门无效/);
});
it.each(['DBARK_RECORD_BATCH_LIVE', 'DBARK_INTEGRATION_ENABLED', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_BATCH_OWNER', 'DBARK_BATCH_UUID', 'DBARK_BATCH_VERSION', 'DBARK_BATCH_HOSTNAME'])('缺失%s不得领取原数据库', field => {
  expect(() => recordBatchLiveEnvironment({ ...mysql(), [field]: undefined }, [], 'darwin')).toThrow();
});
it.each([['--workers=2'], ['--retries', '1'], ['--repeat-each=2'], ['--timeout=240000'], ['--trace=on'], ['--project=其它'], ['--config=其它'], ['--ui'], ['--debug']])('CLI覆盖%s保留原120秒及单次规则', (...args) => {
  expect(() => recordBatchLiveEnvironment(mysql(), args as string[], 'darwin')).toThrow();
});
it('环境或平台改变后永久撤权，恢复原输入也不能复活', () => {
  let env = mysql(); const bound = bindRecordBatchLiveEnvironment(() => ({ env, args: [], platform: 'darwin' })); bound.assertCurrent();
  const original = env; env = { ...env, DBARK_TEST_DATABASE: 'dbark_batch_ffffffffffff' }; expect(() => bound.assertCurrent()).toThrow(/漂移/); env = original; expect(() => bound.assertCurrent()).toThrow(/失效/);
  expect(() => recordBatchLiveEnvironment(mysql(), [], 'linux')).toThrow();
});

it.each([['13357','5.7.44','mysql'],['13380','8.0.46','mysql'],['13384','8.4.11','mysql'],['13310','10.11.15-MariaDB','mariadb'],['13311','11.4.10-MariaDB','mariadb']])('原兼容基线%s只接受准确家族版本%s', (port,version,dialect) => {
  const input: Record<string,string|undefined> = { ...mysql(), DBARK_TEST_PORT:port, DBARK_BATCH_VERSION:version, DBARK_BATCH_DIALECT:dialect }; if(dialect==='mariadb')delete input.DBARK_BATCH_UUID;
  expect(recordBatchLiveEnvironment(input,[],'darwin').port).toBe(Number(port));
  expect(()=>recordBatchLiveEnvironment({...input,DBARK_BATCH_VERSION:version.startsWith('8.4')?'8.0.46':'8.4.11'},[],'darwin')).toThrow();
});

/** 登记真实spec但不执行回调；桌面、数据库或文件资源模块一旦提前加载即失败。 */
function declare(env:Record<string,string|undefined>,args:string[]=[]) {
  const modules:string[]=[],cases:Function[]=[],skip=vi.fn(),use=vi.fn(),configure=vi.fn();
  const test=Object.assign((_name:string,body:Function)=>cases.push(body),{skip,use,afterEach:vi.fn(),afterAll:vi.fn(),describe:{configure}});
  const require=(name:string)=>{modules.push(name);if(name==='@playwright/test')return {test,expect};if(name==='./navigation-menu'||name.includes('/locales/'))return {};if(name==='./record-batch-live-gate')return {bindRecordBatchLiveEnvironment};throw Error('声明阶段拒绝资源模块：'+name);};
  const source=readFileSync(new URL('../e2e/record-batch-live.spec.ts',import.meta.url),'utf8');
  runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:{},require,process:{env,argv:args,platform:'darwin'}});
  return {modules,cases,skip,use,configure};
}
it('默认关闭与list只登记一例，脏认证环境不提前加载桌面或驱动',()=>{
  for(const [env,args] of [[{DBARK_TEST_PASSWORD:'合成秘密'},[]],[{...mysql(),NODE_OPTIONS:'注入应在list不读取'},['--list']],[{...mysql(),DBARK_INTEGRATION_ENABLED:'0'},['--list=true']]] as [Record<string,string|undefined>,string[]][]) {
    const value=declare(env,args);expect(value.cases).toHaveLength(1);expect(value.skip.mock.calls[0][0]).toBe(true);expect(value.modules.some(name=>/desktop|mysql2|node:/.test(name))).toBe(false);expect(value.use).toHaveBeenCalledWith({trace:'off',screenshot:'off',video:'off'});expect(value.configure).toHaveBeenCalledWith({timeout:120000,retries:0});
  }
});
it('显式无效实库来源在加载任何桌面资源之前拒绝',()=>{
  expect(()=>declare({...mysql(),DBARK_TEST_PORT:'3306'})).toThrow(/实库门无效/);
  // 来源有效才走到桌面哨兵；不允许用真实窗口来证明默认开关。
  expect(()=>declare(mysql())).toThrow('声明阶段拒绝资源模块：./desktop-fixture');
});
