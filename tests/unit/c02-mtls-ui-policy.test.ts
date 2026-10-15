import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { c02UiEnabled, withC02UiLifetime } from '../integration/helpers/c02-mtls-policy';
import { c02DesktopEnvironment, c02DialogAnswer, c02PidGone } from '../e2e/c02-mtls-ui-policy';

describe('C02 UI 默认关闭与秘密环境隔离的纯检查', () => {
  it('八种开关组合只有全开才能启动 UI', () => {
    for (const core of ['0', '1']) for (const slice of ['0', '1']) for (const ui of ['0', '1']) expect(c02UiEnabled({ DBARK_INTEGRATION_ENABLED: core, DBARK_C02_MTLS_ENABLED: slice, DBARK_C02_MTLS_UI_ENABLED: ui })).toBe(core === '1' && slice === '1' && ui === '1');
  });
  it('核心已启用但 UI 未启用时，回调租约在读取任何材料之前拒绝', async () => {
    const { runC02MtlS } = await import('../integration/helpers/c02-mtls-fixture');
    const callback = vi.fn(async () => {}), missing = join(process.cwd(), '纯检查不存在的材料.pem');
    await expect(runC02MtlS({ DBARK_INTEGRATION_ENABLED: '1', DBARK_C02_MTLS_ENABLED: '1', DBARK_C02_MTLS_UI_ENABLED: '0', DBARK_C02_ROOT_CONFIRM: '192.168.31.200:13484/c02-mtls', DBARK_C02_HOST: '192.168.31.200', DBARK_C02_PORT: '13484', DBARK_C02_SERVER_UUID: '01234567-89ab-cdef-0123-456789abcdef', DBARK_C02_ADMIN_USER: '虚构', DBARK_C02_ADMIN_PASSWORD: '虚构', DBARK_C02_CA_PATH: missing, DBARK_C02_CA_KEY_PATH: missing, DBARK_C02_OPENSSL_PATH: missing }, callback)).rejects.toThrow('回调租约还需显式开启 UI');
    expect(callback).not.toHaveBeenCalled();
  });
  it('仅继承桌面环境及本例 userData，不向 Electron 传 ROOT 凭据、CA key或启动覆盖', () => {
    const env = c02DesktopEnvironment({ PATH: '工具路径', SystemRoot: '系统路径', DBARK_C02_ADMIN_PASSWORD: '虚构管理口令', DBARK_C02_CA_KEY_PASSPHRASE: '虚构签发口令', DBARK_TEST_PASSWORD: '虚构通用口令', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '额外注入', DBARK_DEV_URL: '非本例地址', DBARK_USER_DATA: '其它目录' }, '本例目录');
    expect(env).toEqual({ PATH: '工具路径', SystemRoot: '系统路径', DBARK_USER_DATA: '本例目录' });
  });
  it('只回答本例已知关闭确认；保存失败不能放弃配置并计作退出通过', () => {
    expect(c02DialogAnswer(['确定', '取消'], '关闭查询标签？请确认需要保留的 SQL 已使用“保存查询”保存。')).toEqual({ response: 0, unexpected: false });
    expect(c02DialogAnswer(['继续工作', '退出客户端'], '退出会放弃尚未提交的表格修改、断开数据库连接并回滚未提交事务。已提交的操作不会撤销。')).toEqual({ response: 1, unexpected: false });
    expect(c02DialogAnswer(['返回工作台', '放弃未保存配置并退出'], '保存失败')).toEqual({ response: 0, unexpected: true });
    expect(c02DialogAnswer([], '其它任务确认')).toEqual({ response: 0, unexpected: true });
  });
  it('交给 Electron 的回答函数可独立序列化，不依赖测试进程闭包或导入', () => {
    const answer = (0, eval)(`(${c02DialogAnswer.toString()})`) as typeof c02DialogAnswer;
    expect(answer(['确定', '取消'], '关闭查询标签？本例确认')).toEqual({ response: 0, unexpected: false });
  });
  it('仅 ESRCH 代表本例 PID 已消失，权限失败或未知异常不能冒充归零', () => {
    expect(c02PidGone(123, () => undefined)).toBe(false);
    expect(c02PidGone(123, () => { throw Object.assign(new Error(), { code: 'ESRCH' }); })).toBe(true);
    for (const code of ['EPERM', 'EACCES', 'EINVAL', undefined]) expect(c02PidGone(123, () => { throw Object.assign(new Error(), { code }); })).toBe(false);
    const probe = vi.fn(); expect(c02PidGone(0, probe)).toBe(false); expect(probe).not.toHaveBeenCalled();
  });
});

describe('C02 UI 回调归还前的生命周期纯检查', () => {
  it('操作结束后退出，再归还资源', async () => {
    const calls: string[] = []; await withC02UiLifetime(async () => { calls.push('UI'); }, async () => { calls.push('退出应用和utility'); }); expect(calls).toEqual(['UI', '退出应用和utility']);
  });
  it('操作失败仍执行退出，保留原异常对象', async () => {
    const first = new Error('原操作失败'), shutdown = vi.fn(async () => {});
    await expect(withC02UiLifetime(async () => { throw first; }, shutdown)).rejects.toBe(first); expect(shutdown).toHaveBeenCalledOnce();
  });
  it('操作与退出都失败时保留首因，退出只调用一次', async () => {
    const first = new Error('原操作失败'), last = new Error('退出失败'), shutdown = vi.fn(async () => { throw last; }); let caught: unknown;
    try { await withC02UiLifetime(async () => { throw first; }, shutdown); } catch (error) { caught = error; }
    expect(caught).toMatchObject({ cause: first, errors: [first, last] }); expect(shutdown).toHaveBeenCalledOnce();
  });
  it('单独退出失败不能算 UI 通过', async () => {
    const failed = new Error('utility仍存活'); await expect(withC02UiLifetime(async () => {}, async () => { throw failed; })).rejects.toBe(failed);
  });
});
