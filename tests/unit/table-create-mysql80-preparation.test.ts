import { describe, expect, it, vi } from 'vitest';
import { assertTableCreateMysql80Facts, prepareTableCreateMysql80, tableCreateMysql80Target, type TableCreateMysql80PreparationPorts } from '../helpers/tableCreateMysql80Preparation';

const uuid = '11111111-2222-3333-4444-555555555555';
const environment = () => ({ DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13380', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成原始账号', DBARK_TEST_PASSWORD: '合成原始密码', DBARK_TEST_EXPECTED_SERVER_UUID: uuid });
const facts = () => [{ dialect: 'mysql', version: '8.0.46', os: 'Linux', names: 0, uuid }];
/** 仅RAM端口：不包含SQL、隔离建库、桌面或任何真实驱动；记录每次读取与严格收尾次数。 */
function fixture() {
  const readFacts = vi.fn(async (): Promise<unknown> => facts()), closeStrict = vi.fn(async () => {});
  const ports: TableCreateMysql80PreparationPorts = { assertCurrent: vi.fn(), retain: vi.fn(), openReadonly: vi.fn(async () => ({ readFacts, closeStrict })) };
  return { ports, readFacts, closeStrict };
}

describe('新建表8.0.46原始目标和凭据双份明确一致', () => {
  it('正常目标不返回凭据，显式空密码可以准备', () => {
    const raw = { ...environment(), DBARK_TEST_PASSWORD: '' }, target = tableCreateMysql80Target(raw, { ...raw });
    expect(target).toEqual({ host: '192.168.31.200', port: 13380, tls: false, serverUuid: uuid }); expect(Object.isFrozen(target)).toBe(true);
    expect(JSON.stringify(target)).not.toContain(raw.DBARK_TEST_USER); expect(target).not.toHaveProperty('password');
  });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'])('原始%s缺失时helper回填仍拒绝', name => {
    const raw: Record<string, string | undefined> = environment(), helper = { ...raw }; delete raw[name];
    expect(() => tableCreateMysql80Target(raw, helper)).toThrow('显式凭据');
    expect(() => tableCreateMysql80Target(Object.create(helper), helper)).toThrow();
  });
  it.each(['DBARK_TEST_HOST', 'DBARK_TEST_PORT', 'DBARK_TEST_TLS', 'DBARK_TEST_USER', 'DBARK_TEST_PASSWORD', 'DBARK_TEST_EXPECTED_SERVER_UUID'])('helper%s与原始值不同即拒绝', name => {
    const raw = environment(); expect(() => tableCreateMysql80Target(raw, { ...raw, [name]: '另一合成值' })).toThrow();
  });
  it.each([{ DBARK_TEST_HOST: 'deve-server.yinzon.com' }, { DBARK_TEST_PORT: '13384' }, { DBARK_TEST_PORT: '013380' }, { DBARK_TEST_TLS: '1' }, { DBARK_TEST_TLS: '' }, { DBARK_TEST_USER: '  ' }, { DBARK_TEST_EXPECTED_SERVER_UUID: uuid + '\n' }, { DBARK_TEST_EXPECTED_SERVER_UUID: 'unknown' }])('目标%s即使两份相同也不属于本片', change => {
    const raw = { ...environment(), ...change }; expect(() => tableCreateMysql80Target(raw, raw)).toThrow();
  });
  it('错误输入与helper回填在打开端口前拒绝，不输出凭据值', async () => {
    const raw: Record<string, string | undefined> = environment(), helper = { ...raw }; delete raw.DBARK_TEST_PASSWORD;
    const f = fixture(); const failure = await prepareTableCreateMysql80(raw, helper, f.ports).catch(reason => reason);
    expect(failure).toBeInstanceOf(Error); expect(failure.message).not.toContain(helper.DBARK_TEST_PASSWORD);
    expect(f.ports.openReadonly).not.toHaveBeenCalled(); expect(f.ports.retain).not.toHaveBeenCalled();
  });
});

describe('新建表8.0.46事实与未知停链准备', () => {
  it.each([{ version: '8.0.47' }, { dialect: 'mariadb' }, { version: '8.4.11' }, { os: 'Win64' }, { names: 1 }, { names: false }, { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { uuid: uuid + '\n' }])('实际事实%s不同不能进入正式执行', async change => {
    const f = fixture(), raw = environment(); f.readFacts.mockResolvedValue([{ ...facts()[0], ...change }]);
    await expect(prepareTableCreateMysql80(raw, { ...raw }, f.ports)).rejects.toThrow();
    expect(f.readFacts).toHaveBeenCalledTimes(1); expect(f.closeStrict).toHaveBeenCalledTimes(1); expect(f.ports.retain).not.toHaveBeenCalled();
  });
  it.each([null, [], [{ version: '8.0.46' }], [facts()[0], facts()[0]], [Object.create(facts()[0])]])('不完整事实%s不补默认值', rows => {
    const raw = environment(); expect(() => assertTableCreateMysql80Facts(rows, tableCreateMysql80Target(raw, raw))).toThrow();
  });
  it('通过只返回不可写准备和实际严格收尾事实，固定首await前凭据', async () => {
    const raw = environment(), helper = { ...raw }, f = fixture();
    const open = vi.mocked(f.ports.openReadonly); open.mockImplementation(async (target, credentials) => {
      expect(target.port).toBe(13380); expect(Object.isFrozen(credentials)).toBe(true);
      raw.DBARK_TEST_USER = helper.DBARK_TEST_USER = '迟到另一账号';
      expect(credentials.user).toBe('合成原始账号'); expect(credentials.password).toBe('合成原始密码');
      return { readFacts: f.readFacts, closeStrict: f.closeStrict };
    });
    const result = await prepareTableCreateMysql80(raw, helper, f.ports);
    expect(result).toMatchObject({ canWrite: false, resourcesReleased: true, profile: { state: 'prepared', canWrite: false } });
    expect(JSON.stringify(result)).not.toMatch(/合成原始账号|合成原始密码|迟到另一账号/); expect(Object.isFrozen(result)).toBe(true);
    expect(f.readFacts).toHaveBeenCalledTimes(1); expect(f.closeStrict).toHaveBeenCalledTimes(1);
  });
  it('严格close Promise未完成前不发布准备结果，不用取消ACK代收尾', async () => {
    const raw = environment(), f = fixture(); let release!: () => void, published = false;
    f.closeStrict.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = prepareTableCreateMysql80(raw, raw, f.ports).then(result => { published = true; return result; });
    await vi.waitFor(() => expect(f.closeStrict).toHaveBeenCalledTimes(1)); expect(published).toBe(false);
    release(); expect((await pending).canWrite).toBe(false); expect(published).toBe(true);
  });
  it('打开结果未知只保留，不自动重连或尝试读取', async () => {
    const raw = environment(), f = fixture(); vi.mocked(f.ports.openReadonly).mockRejectedValue(Error('合成打开未知'));
    await expect(prepareTableCreateMysql80(raw, raw, f.ports)).rejects.toThrow('合成打开未知');
    expect(f.ports.openReadonly).toHaveBeenCalledTimes(1); expect(f.ports.retain).toHaveBeenCalled(); expect(f.readFacts).not.toHaveBeenCalled();
  });
  it('读取结果未知不二读、不借退出/清理继续后链', async () => {
    const raw = environment(), f = fixture(); f.readFacts.mockRejectedValue(Error('合成读取未知'));
    await expect(prepareTableCreateMysql80(raw, raw, f.ports)).rejects.toThrow('合成读取未知');
    expect(f.ports.retain).toHaveBeenCalled(); expect(f.readFacts).toHaveBeenCalledTimes(1); expect(f.closeStrict).not.toHaveBeenCalled();
  });
  it('关闭未知不发布资源释放且不重试', async () => {
    const raw = environment(), f = fixture(); f.closeStrict.mockRejectedValue(Error('合成关闭未知'));
    await expect(prepareTableCreateMysql80(raw, raw, f.ports)).rejects.toThrow('合成关闭未知');
    expect(f.ports.retain).toHaveBeenCalled(); expect(f.closeStrict).toHaveBeenCalledTimes(1);
  });
  it('事实不符且关闭未知同时保留首因', async () => {
    const raw = environment(), f = fixture(); f.readFacts.mockResolvedValue([{ ...facts()[0], version: '8.4.11' }]); f.closeStrict.mockRejectedValue(Error('合成关闭未知'));
    const failure = await prepareTableCreateMysql80(raw, raw, f.ports).catch(reason => reason);
    expect(failure).toBeInstanceOf(AggregateError); expect(failure.errors).toHaveLength(2); expect(failure.cause.message).toContain('实际版本'); expect(f.ports.retain).toHaveBeenCalled();
  });
  it.each([1, 2, 4, 6])('第%s次归属核对未知立即保留，不把旧owner当成新例', async stop => {
    const raw = environment(), f = fixture(); let calls = 0;
    vi.mocked(f.ports.assertCurrent).mockImplementation(() => { if (++calls === stop) throw Error('合成归属未知'); });
    await expect(prepareTableCreateMysql80(raw, raw, f.ports)).rejects.toThrow('合成归属未知'); expect(f.ports.retain).toHaveBeenCalled();
    if (stop === 1) expect(f.ports.openReadonly).not.toHaveBeenCalled();
    if (stop === 2) expect(f.readFacts).not.toHaveBeenCalled();
    if (stop === 4) expect(f.closeStrict).not.toHaveBeenCalled();
    if (stop === 6) expect(f.closeStrict).toHaveBeenCalledTimes(1);
  });
});
