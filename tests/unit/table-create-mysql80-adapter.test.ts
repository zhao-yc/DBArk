import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const driver = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('mysql2/promise', () => ({ default: { createConnection: driver.open } }));
import { tableCreateMysql80PreparationPorts } from '../helpers/tableCreateMysql80Adapter';
import { prepareTableCreateMysql80 } from '../helpers/tableCreateMysql80Preparation';
const uuid = '11111111-2222-3333-4444-555555555555';
const raw = () => ({ DBARK_TEST_HOST: '192.168.31.200', DBARK_TEST_PORT: '13380', DBARK_TEST_TLS: '0', DBARK_TEST_USER: '合成账号', DBARK_TEST_PASSWORD: '', DBARK_TEST_EXPECTED_SERVER_UUID: uuid });
/** 只替换驱动，严格关闭运行产品closeMysqlConnection，显式观察QUIT写入及底层close。 */
function connection(change: Record<string, unknown> = {}, hold = false) {
  let release!: () => void;
  const stream = Object.assign(new EventEmitter(), { closed: false, end: vi.fn((callback: () => void) => { release = () => { callback(); stream.closed = true; stream.emit('close'); }; if (!hold) queueMicrotask(release); }), destroy: vi.fn(() => { stream.closed = true; stream.emit('close'); }) });
  const core = Object.assign(new EventEmitter(), { stream, end: vi.fn((callback: () => void) => { queueMicrotask(callback); }), destroy: vi.fn(() => {}) });
  const observer = { connection: core, query: vi.fn(async () => [[{ version: '8.0.46', os: 'Linux', names: 0, uuid, ...change }]]), end: vi.fn(async () => { throw Error('不得用Promise.end替代严格关闭'); }) };
  return { observer, core, stream, release: () => release() };
}
beforeEach(() => { driver.open.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
describe('8.0.46真实只读预检适配器（仅RAM驱动）', () => {
  it('固定13380/plain、无默认库，产品严格关闭后才发布资源事实', async () => {
    const f = connection(), input = raw(), owner = { assertCurrent: vi.fn(), retain: vi.fn() }; driver.open.mockResolvedValue(f.observer);
    expect(await prepareTableCreateMysql80(input, { ...input }, tableCreateMysql80PreparationPorts(owner))).toMatchObject({ resourcesReleased: true, canWrite: false });
    expect(driver.open).toHaveBeenCalledExactlyOnceWith({ host: '192.168.31.200', port: 13380, user: '合成账号', password: '', charset: 'utf8mb4', connectTimeout: 15000 });
    expect(f.observer.query).toHaveBeenCalledTimes(1); expect(f.core.end).toHaveBeenCalledTimes(1); expect(f.stream.closed).toBe(true); expect(f.observer.end).not.toHaveBeenCalled();
  });
  it('严格关闭等待底层close，未完成时不发布预检成功', async () => {
    const f = connection({}, true), input = raw(); driver.open.mockResolvedValue(f.observer); let finished = false;
    const pending = prepareTableCreateMysql80(input, input, tableCreateMysql80PreparationPorts({ assertCurrent() {}, retain() {} })).then(value => { finished = true; return value; });
    await vi.waitFor(() => expect(f.stream.end).toHaveBeenCalledTimes(1)); expect(finished).toBe(false); f.release(); expect((await pending).resourcesReleased).toBe(true);
  });
  it.each([{ version: '8.0.47' }, { version: '8.0.46-MariaDB' }, { uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }, { os: 'Win64' }, { names: 1 }])('实际事实%s不符仍严格关闭且不得继续建库', async change => {
    const f = connection(change), input = raw(); driver.open.mockResolvedValue(f.observer);
    await expect(prepareTableCreateMysql80(input, input, tableCreateMysql80PreparationPorts({ assertCurrent() {}, retain() {} }))).rejects.toThrow();
    expect(f.stream.closed).toBe(true); expect(f.observer.query).toHaveBeenCalledTimes(1);
  });
  it('底层流未知不能用end回调冒充严格收尾', async () => {
    const f = connection(), input = raw(), retain = vi.fn(); delete (f.core as any).stream; driver.open.mockResolvedValue(f.observer);
    await expect(prepareTableCreateMysql80(input, input, tableCreateMysql80PreparationPorts({ assertCurrent() {}, retain }))).rejects.toThrow('底层流未知'); expect(retain).toHaveBeenCalled();
  });
  it('读取未知时保留且不重试或借关闭继续后链', async () => {
    const f = connection(), input = raw(), retain = vi.fn(); f.observer.query.mockRejectedValue(Error('合成读取未知')); driver.open.mockResolvedValue(f.observer);
    await expect(prepareTableCreateMysql80(input, input, tableCreateMysql80PreparationPorts({ assertCurrent() {}, retain }))).rejects.toThrow('合成读取未知'); expect(f.core.end).not.toHaveBeenCalled(); expect(retain).toHaveBeenCalled();
  });
});
