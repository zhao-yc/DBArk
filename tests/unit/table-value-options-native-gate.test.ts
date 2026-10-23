import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertTableValueOptionsUiEnvironment as assertEnvironment, bindTableValueOptionsUiEnvironment, installTableValueOptionsConfirmation as install, readTableValueOptionsConfirmations as readConfirmations, tableValueOptionsUiActive } from '../e2e/table-value-options-native-gate';
const environment = (): NodeJS.ProcessEnv => ({ DBARK_INTEGRATION_ENABLED: '1', DBARK_TABLE_VALUE_OPTIONS_UI: '1', DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13384', DBARK_TEST_TLS: '0', DBARK_TEST_DATABASE: 'dbark_e2e_tablevalues_' + 'a'.repeat(32), DBARK_TEST_USER: 'isolated', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: 'f568f70e-c730-11f1-8190-3e6c830dde01', DBARK_TABLE_VALUE_OPTIONS_OWNER: 'dbark-table-value-options:' + 'a'.repeat(32), DBARK_TABLE_VALUE_OPTIONS_MANIFEST: 'D:\\isolated\\manifest.json', DBARK_TABLE_VALUE_OPTIONS_MANIFEST_SHA256: 'a'.repeat(64) });
describe('表页不同值正式窗口专用门（纯RAM）', () => {
  it('默认和列表不启用，须两个开关', () => { expect(tableValueOptionsUiActive({}, [])).toBe(false); expect(tableValueOptionsUiActive(environment(), ['--list'])).toBe(false); expect(tableValueOptionsUiActive(environment(), ['--list=true'])).toBe(false); expect(tableValueOptionsUiActive(environment(), [])).toBe(true); });
  it('接受准确只读预置库', () => { expect(() => assertEnvironment(environment(), ['test', '--trace=off'], 'win32')).not.toThrow(); });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_DATABASE', 'DBARK_TEST_EXPECTED_SERVER_UUID', 'DBARK_TABLE_VALUE_OPTIONS_OWNER', 'DBARK_TABLE_VALUE_OPTIONS_MANIFEST', 'DBARK_TABLE_VALUE_OPTIONS_MANIFEST_SHA256'])('关键环境不能换成任意值 %s', key => { const env = environment(); env[key] = 'other'; expect(() => assertEnvironment(env, [], 'win32')).toThrow(); });
  it.each(['DBARK_DEV_URL', 'DBARK_USER_DATA', 'DBARK_EXECUTABLE_PATH', 'NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'])('替代运行参数连空值也拒绝 %s', key => { const env = environment(); env[key] = ''; expect(() => assertEnvironment(env, [], 'win32')).toThrow(); });
  it.each([['--trace=on'], ['--trace', 'retain-on-failure'], ['--config=other.ts'], ['-cother.ts'], ['--ui'], ['--debug']].map(args => ({ args })))('拒绝CLI绕行 $args', ({ args }) => { expect(() => assertEnvironment(environment(), args, 'win32')).toThrow(); });
  it('大小写别名、平台改变均拒绝', () => { expect(() => assertEnvironment({ ...environment(), dbark_test_host: 'other' }, [], 'win32')).toThrow(); expect(() => assertEnvironment(environment(), [], 'darwin')).toThrow(); });
  it('环境或argv漂移后即使恢复也永久停链', () => { const env = environment(), args: string[] = [], gate = bindTableValueOptionsUiEnvironment(() => ({ env, args, platform: 'win32' })); gate.assertCurrent(); env.DBARK_TEST_PORT = '13380'; expect(() => gate.assertCurrent()).toThrow(); env.DBARK_TEST_PORT = '13384'; expect(() => gate.assertCurrent()).toThrow(); });
});

describe('一次性Electron确认适配器守卫（纯RAM，不代表系统按钮输入）', () => {
  const owner = 'dbark-table-value-options:' + 'b'.repeat(32), expected = '仅本例准确丢稿确认';
  afterEach(() => { Reflect.deleteProperty(globalThis, '__dbarkTableValueOptionsConfirmation'); });
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
    expect(() => install({ dialog }, { owner: 'dbark-table-value-options:' + 'c'.repeat(32), expected, choice: 'accept' })).toThrow();
    install({ dialog }, { owner, expected, choice: 'accept' }); expect(() => old({ message: expected, buttons: ['OK', 'Cancel'], cancelId: 1 } as never)).toThrow();
    expect(dialog.showMessageBoxSync({ message: expected, buttons: ['OK', 'Cancel'], cancelId: 1 } as never)).toBe(0); expect(readConfirmations({ dialog }, owner)).toHaveLength(2);
  });
});
