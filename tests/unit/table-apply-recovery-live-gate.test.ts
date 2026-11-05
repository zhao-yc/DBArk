import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installApplyRecoveryConfirmation as install, readApplyRecoveryConfirmations as readConfirmations, bindApplyRecoveryLiveEnvironment, applyRecoveryLiveEnvironment } from '../e2e/table-apply-recovery-live-gate';

const mysql = () => ({ DBARK_APPLY_RECOVERY_LIVE: '1', DBARK_RECOVERY_MODE: 'unknown', DBARK_INTEGRATION_ENABLED: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_USER: '合成用户', DBARK_TEST_PASSWORD: '合成密码不连接', DBARK_TEST_DATABASE: 'dbark_recovery_012345abcdef', DBARK_RECOVERY_OWNER: 'a'.repeat(32), DBARK_RECOVERY_VERSION: '8.4.11', DBARK_RECOVERY_HOSTNAME: 'test-container', DBARK_RECOVERY_UUID: 'abcdef01-1234-5678-9abc-0123456789ab', DBARK_RECOVERY_DIALECT: 'mysql' });
it('两种基线身份与准确随机库明确绑定，固定原生资源门不被命令行覆盖', () => {
  expect(applyRecoveryLiveEnvironment(mysql(), ['--workers=1', '--trace', 'off'], 'darwin')).toMatchObject({ dialect: 'mysql', port: 13384 });
  const { DBARK_RECOVERY_UUID: _, ...maria } = { ...mysql(), DBARK_RECOVERY_VERSION: '11.4.10-MariaDB-ubu2404', DBARK_TEST_PORT: '13311', DBARK_RECOVERY_DIALECT: 'mariadb' };
  expect(applyRecoveryLiveEnvironment(maria, [], 'win32')).toMatchObject({ dialect: 'mariadb', port: 13311 });
  expect(() => applyRecoveryLiveEnvironment({ ...maria, DBARK_TEST_PORT: '13384' }, [], 'darwin')).toThrow();
  expect(() => applyRecoveryLiveEnvironment({ ...mysql(), DBARK_TEST_PORT: '13311' }, [], 'darwin')).toThrow();
});
it.each(['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'SSH_AUTH_SOCK', 'PWDEBUG', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'DBARK_SSH_KEY', 'MYSQL_PASSWORD', 'PGPASSWORD'])('危险外部字段%s在声明阶段拒绝，不泄露其值', field => {
  expect(() => applyRecoveryLiveEnvironment({ ...mysql(), [field]: '不得输出的合成值' }, [], 'darwin')).toThrow(/实库门无效/);
});
it.each(['DBARK_APPLY_RECOVERY_LIVE', 'DBARK_INTEGRATION_ENABLED', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_DATABASE', 'DBARK_RECOVERY_MODE', 'DBARK_RECOVERY_OWNER', 'DBARK_RECOVERY_UUID', 'DBARK_RECOVERY_VERSION', 'DBARK_RECOVERY_HOSTNAME'])('缺失%s不得领取原数据库', field => {
  expect(() => applyRecoveryLiveEnvironment({ ...mysql(), [field]: undefined }, [], 'darwin')).toThrow();
});
it.each([['--workers=2'], ['--retries', '1'], ['--repeat-each=2'], ['--timeout=240000'], ['--trace=on'], ['--project=其它'], ['--config=其它'], ['--ui'], ['--debug']])('CLI覆盖%s保留原120秒及单次规则', (...args) => {
  expect(() => applyRecoveryLiveEnvironment(mysql(), args as string[], 'darwin')).toThrow();
});
it('环境或平台改变后永久撤权，恢复原输入也不能复活', () => {
  let env = mysql(); const bound = bindApplyRecoveryLiveEnvironment(() => ({ env, args: [], platform: 'darwin' })); bound.assertCurrent();
  const original = env; env = { ...env, DBARK_TEST_DATABASE: 'dbark_recovery_ffffffffffff' }; expect(() => bound.assertCurrent()).toThrow(/漂移/); env = original; expect(() => bound.assertCurrent()).toThrow(/失效/);
  expect(() => applyRecoveryLiveEnvironment(mysql(), [], 'linux')).toThrow();
});

it.each([['13357','5.7.44','mysql'],['13380','8.0.46','mysql'],['13384','8.4.11','mysql'],['13310','10.11.15-MariaDB','mariadb'],['13311','11.4.10-MariaDB','mariadb']])('原兼容基线%s只接受准确家族版本%s', (port,version,dialect) => {
  const input: Record<string,string|undefined> = { ...mysql(), DBARK_TEST_PORT:port, DBARK_RECOVERY_VERSION:version, DBARK_RECOVERY_DIALECT:dialect }; if(dialect==='mariadb')delete input.DBARK_RECOVERY_UUID;
  expect(applyRecoveryLiveEnvironment(input,[],'darwin').port).toBe(Number(port));
  expect(()=>applyRecoveryLiveEnvironment({...input,DBARK_RECOVERY_VERSION:version.startsWith('8.4')?'8.0.46':'8.4.11'},[],'darwin')).toThrow();
});

/** 登记真实spec但不执行回调；桌面、数据库或文件资源模块一旦提前加载即失败。 */
function declare(env:Record<string,string|undefined>,args:string[]=[]) {
  const modules:string[]=[],cases:Function[]=[],skip=vi.fn(),use=vi.fn(),configure=vi.fn();
  const test=Object.assign((_name:string,body:Function)=>cases.push(body),{skip,use,afterEach:vi.fn(),afterAll:vi.fn(),describe:{configure}});
  const require=(name:string)=>{modules.push(name);if(name==='@playwright/test')return {test,expect};if(name==='./navigation-menu'||name.includes('/locales/'))return {};if(name==='./table-apply-recovery-live-gate')return {bindApplyRecoveryLiveEnvironment};throw Error('声明阶段拒绝资源模块：'+name);};
  const source=readFileSync(new URL('../e2e/table-apply-recovery-live.spec.ts',import.meta.url),'utf8');
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

it.each(['lost-reply','read-failure','unknown','rolled-back'])('仅明确%s场景可领取本随机库，非法场景不启用窗口',mode=>{expect(applyRecoveryLiveEnvironment({...mysql(),DBARK_RECOVERY_MODE:mode},[],'darwin').mode).toBe(mode);expect(()=>applyRecoveryLiveEnvironment({...mysql(),DBARK_RECOVERY_MODE:'retry-all'},[],'darwin')).toThrow();});

describe('一次性Electron确认适配器守卫（纯RAM，不代表系统按钮输入）', () => {
  const owner = 'dbark-apply-recovery:' + 'b'.repeat(32), expected = '仅本例准确丢稿确认';
  afterEach(() => { Reflect.deleteProperty(globalThis, '__dbarkApplyRecoveryConfirmation'); });
  /** 只提供Electron函数端口，实际产品状态与window.confirm均不参与此RAM测试。 */
  const port = () => ({ showMessageBoxSync: vi.fn((..._args: unknown[]) => 99), showMessageBox: vi.fn(async (..._args: unknown[]) => ({ response: 99, checkboxChecked: true })) });
  it('安装不等于消费；sync拒绝取实际cancelId=0并立即恢复两个函数', () => {
    const dialog = port(), sync = dialog.showMessageBoxSync, asynchronous = dialog.showMessageBox;
    install({ dialog }, { owner, expected, choice: 'reject' }); expect(() => readConfirmations({ dialog }, owner)).toThrow();
    const options = { message: expected, buttons: ['Cancel', 'OK'], cancelId: 0, defaultId: 1, type: 'question' };
    expect(dialog.showMessageBoxSync(options as never)).toBe(0); expect(dialog.showMessageBoxSync).toBe(sync); expect(dialog.showMessageBox).toBe(asynchronous); expect(sync).not.toHaveBeenCalled(); expect(asynchronous).not.toHaveBeenCalled();
    const records = readConfirmations({ dialog }, owner); expect(records).toEqual([{ method: 'sync', options, choice: 'reject', cancelIndex: 0, acceptIndex: 1, response: 0 }]); options.buttons[0] = 'changed'; expect(readConfirmations({ dialog }, owner)[0].options.buttons).toEqual(['Cancel', 'OK']);
  });
  it('sync与async各消费一次，接受来自明确另一按钮而非固定索引', async () => {
    const dialog = port(), sync = dialog.showMessageBoxSync, asynchronous = dialog.showMessageBox;
    install({ dialog }, { owner, expected, choice: 'reject' }); expect(dialog.showMessageBoxSync({ message: expected, buttons: ['确定', '取消'], defaultId: 0 } as never)).toBe(1);
    install({ dialog }, { owner, expected, choice: 'accept' }); expect(await dialog.showMessageBox({ message: expected, buttons: ['取消', '确定'], cancelId: 0, defaultId: 1 } as never)).toEqual({ response: 1, checkboxChecked: false });
    expect(dialog.showMessageBoxSync).toBe(sync); expect(dialog.showMessageBox).toBe(asynchronous); const records = readConfirmations({ dialog }, owner); expect(records.map(value => [value.method, value.choice, value.response])).toEqual([['sync', 'reject', 1], ['async', 'accept', 1]]);
  });
  it('只允许准确message，遇未知确认恢复两个函数并永久拒绝重装', () => {
    const dialog = port(), sync = dialog.showMessageBoxSync, asynchronous = dialog.showMessageBox;
    install({ dialog }, { owner, expected, choice: 'accept' }); expect(() => dialog.showMessageBoxSync({ message: 'other', buttons: ['OK', 'Cancel'], cancelId: 1 } as never)).toThrow();
    expect(dialog.showMessageBoxSync).toBe(sync); expect(dialog.showMessageBox).toBe(asynchronous); expect(() => readConfirmations({ dialog }, owner)).toThrow(); expect(() => install({ dialog }, { owner, expected, choice: 'accept' })).toThrow();
  });
  it.each([
    { buttons: ['继续', '结束'] }, { buttons: ['OK', 'Cancel', '取消'], cancelId: 1 }, { buttons: ['Cancel', 'OK'], cancelId: 1 }, { buttons: ['Cancel', '不明'], cancelId: 0 }, { buttons: ['OK', 'Cancel'], cancelId: 4 },
  ])('未知/矛盾按钮选项拒绝回答且恢复原函数 $buttons', options => {
    const dialog = port(), sync = dialog.showMessageBoxSync, asynchronous = dialog.showMessageBox; install({ dialog }, { owner, expected, choice: 'reject' }); expect(() => dialog.showMessageBoxSync({ message: expected, ...options } as never)).toThrow(); expect(dialog.showMessageBoxSync).toBe(sync); expect(dialog.showMessageBox).toBe(asynchronous); expect(() => readConfirmations({ dialog }, owner)).toThrow();
  });
  it('旧一次性wrapper不能消费下一次准确确认，也不能被另一owner接管', () => {
    const dialog = port(); install({ dialog }, { owner, expected, choice: 'reject' }); const old = dialog.showMessageBoxSync;
    dialog.showMessageBoxSync({ message: expected, buttons: ['OK', 'Cancel'], cancelId: 1 } as never);
    expect(() => install({ dialog }, { owner: 'dbark-apply-recovery:' + 'c'.repeat(32), expected, choice: 'accept' })).toThrow();
    install({ dialog }, { owner, expected, choice: 'accept' }); expect(() => old({ message: expected, buttons: ['OK', 'Cancel'], cancelId: 1 } as never)).toThrow();
    expect(dialog.showMessageBoxSync({ message: expected, buttons: ['OK', 'Cancel'], cancelId: 1 } as never)).toBe(0); expect(readConfirmations({ dialog }, owner)).toHaveLength(2);
  });
});
