import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertDatabaseDefaultEncodingTargetAvailable, databaseDefaultEncodingServices } from '../../src/renderer/databaseDefaultEncodingServices';
import { databaseDefaultEncodingAcknowledgements } from '../../src/shared/databaseDefaultEncoding';
import { databaseDefaultEncodingAckLabel, databaseDefaultEncodingAcksComplete, databaseDefaultEncodingFailure, sameDatabaseDefaultEncodingTarget, changeDefaultCharset, defaultEncodingSelectable } from '../../src/renderer/databaseDefaultEncodingUi';
import type { WorkspaceTab } from '../../src/renderer/store';

const target = { connectionId: 'c', database: 'db' }, pair = { charset: 'utf8mb4', collation: 'utf8mb4_bin' };
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => { if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window'); });
describe('数据库默认编码真实服务适配器与能力选择', () => {
  it('配对只来自快照候选，切换字符集清空不匹配排序规则', () => {
    expect(changeDefaultCharset(pair, 'latin1', [pair])).toEqual({ charset: 'latin1', collation: '' }); expect(defaultEncodingSelectable({ ...pair, charset: 'UTF8MB4' }, [pair])).toBe(false); expect(defaultEncodingSelectable(pair, [pair])).toBe(true);
  });
  it('目标元组精确匹配大小写和连接，不拼接碰撞分隔符', () => {
    expect(sameDatabaseDefaultEncodingTarget(target, { ...target })).toBe(true); expect(sameDatabaseDefaultEncodingTarget(target, { ...target, database: 'DB' })).toBe(false); expect(sameDatabaseDefaultEncodingTarget({ connectionId: 'a:b', database: 'c' }, { connectionId: 'a', database: 'b:c' })).toBe(false);
  });
  it('全部风险唯一且已知才可完成，未知原型属性不映射文案', () => {
    const acks = [...databaseDefaultEncodingAcknowledgements]; expect(databaseDefaultEncodingAcksComplete(acks, new Set(acks))).toBe(true); for (const id of acks) expect(databaseDefaultEncodingAckLabel(id)).toMatch(/[\u4e00-\u9fff]/); expect(databaseDefaultEncodingAckLabel('__proto__')).toBeUndefined(); expect(databaseDefaultEncodingAckLabel('constructor')).toBeUndefined();
    for (const bad of [acks.slice(1), [...acks, acks[0]], [...acks, 'other'], ['__proto__', 'constructor', 'other']]) expect(databaseDefaultEncodingAcksComplete(bad, new Set(bad))).toBe(false); expect(databaseDefaultEncodingAcksComplete(acks, new Set([...acks, 'extra']))).toBe(false);
  });
  it('失败不猜未发送，提交未知与完成未核验分别处理', () => {
    expect(databaseDefaultEncodingFailure(null, false)).toBe('notSent'); expect(databaseDefaultEncodingFailure(null, true)).toBe('unknown'); expect(databaseDefaultEncodingFailure({ phase: 'releasing', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' }, true)).toBe('notSent'); expect(databaseDefaultEncodingFailure({ phase: 'releasing', ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' }, true)).toBe('verificationFailed');
  });
  it('只等精确同库表页在途任务，已有数据草稿不丢失也不阻止默认值编辑', () => {
    const tabs: WorkspaceTab[] = [{ id: 'hidden', kind: 'table', title: 't', ...target, table: 't' }], workspace = { settings: { tabs }, dirtyTabs: { hidden: true }, activeJobs: {} }; const before = structuredClone(workspace);
    expect(() => assertDatabaseDefaultEncodingTargetAvailable(target, workspace)).not.toThrow(); expect(workspace).toEqual(before); expect(() => assertDatabaseDefaultEncodingTargetAvailable(target, { ...workspace, activeJobs: { hidden: true } })).toThrow('活动操作'); expect(() => assertDatabaseDefaultEncodingTargetAvailable({ ...target, database: 'DB' }, { ...workspace, activeJobs: { hidden: true } })).not.toThrow(); expect(() => assertDatabaseDefaultEncodingTargetAvailable({ ...target, connectionId: 'other' }, { ...workspace, activeJobs: { hidden: true } })).not.toThrow();
  });
  it('活动原型属性不能冒充任务，大工作区明确拒绝而不漏检', () => {
    const tabs: WorkspaceTab[] = [{ id: 'hidden', kind: 'table', title: 't', ...target, table: 't' }]; expect(() => assertDatabaseDefaultEncodingTargetAvailable(target, { settings: { tabs }, activeJobs: Object.create({ hidden: true }) })).not.toThrow(); expect(() => assertDatabaseDefaultEncodingTargetAvailable(target, { settings: { tabs: Array(1001).fill(tabs[0]) }, activeJobs: {} })).toThrow('预算');
  });
  it('get/preview/apply/release/cancel逐一经正式IPC，只有明确apply发送写入命令', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined); Object.defineProperty(globalThis, 'window', { configurable: true, value: { dbark: { invoke } } });
    const get = { ...target, taskId: 'get-task' }, preview = { snapshotId: 'snapshot', ...pair, taskId: 'preview-task' }, apply = { previewToken: 'preview', confirmation: target.database, acknowledgements: [...databaseDefaultEncodingAcknowledgements], taskId: 'apply-task' };
    await databaseDefaultEncodingServices.get(get); await databaseDefaultEncodingServices.preview(preview); await databaseDefaultEncodingServices.apply(apply); await databaseDefaultEncodingServices.release({ previewToken: 'preview' }); await databaseDefaultEncodingServices.cancel({ taskId: 'get-task' });
    expect(invoke.mock.calls).toEqual([['connections.open', { id: target.connectionId }], ['schema.databaseDefaultEncoding.get', get], ['schema.databaseDefaultEncoding.preview', preview], ['schema.databaseDefaultEncoding.apply', apply], ['schema.databaseDefaultEncoding.release', { previewToken: 'preview' }], ['query.cancel', { taskId: 'get-task' }]]);
  });
  it('get等待真实连接准备，连接失败不发送get也不回退或重试', async () => {
    let resolve!: () => void; const pending = new Promise<void>(yes => { resolve = yes; }), invoke = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined); Object.defineProperty(globalThis, 'window', { configurable: true, value: { dbark: { invoke } } });
    const input = { ...target, taskId: 'get-task' }, request = databaseDefaultEncodingServices.get(input); expect(invoke.mock.calls).toEqual([['connections.open', { id: target.connectionId }]]); resolve(); await request; expect(invoke.mock.calls[1]).toEqual(['schema.databaseDefaultEncoding.get', input]);
    invoke.mockReset().mockRejectedValueOnce(Error('连接失败')); await expect(databaseDefaultEncodingServices.get(input)).rejects.toThrow('连接失败'); expect(invoke.mock.calls).toEqual([['connections.open', { id: target.connectionId }]]);
  });
  it('连接准备期间原窗口或修订失效不发送get，失效源不先打开连接', async () => {
    let resolve!: () => void; const pending = new Promise<void>(yes => { resolve = yes; }), invoke = vi.fn().mockReturnValueOnce(pending); Object.defineProperty(globalThis, 'window', { configurable: true, value: { dbark: { invoke } } });
    let current = true; const request = databaseDefaultEncodingServices.get({ ...target, taskId: 'get' }, () => current); current = false; resolve(); await expect(request).rejects.toThrow('目标或连接配置'); expect(invoke.mock.calls).toEqual([['connections.open', { id: target.connectionId }]]); invoke.mockReset(); await expect(databaseDefaultEncodingServices.get({ ...target, taskId: 'stale' }, () => false)).rejects.toThrow('目标或连接配置'); expect(invoke).not.toHaveBeenCalled();
  });
  it('订阅只转交本功能结构进度并保留原任务ID，取消订阅返回真实函数', () => {
    let handler: ((value: any) => void) | undefined; const unsubscribe = vi.fn(), listener = vi.fn(); Object.defineProperty(globalThis, 'window', { configurable: true, value: { dbark: { onTask: (value: typeof handler) => { handler = value; return unsubscribe; } } } });
    const close = databaseDefaultEncodingServices.subscribe(listener), progress = { phase: 'reading', ddlSubmitted: false, ddlCompleted: false, definitionVerified: false }; handler!({ taskId: 'other', tableDefaultEncoding: progress }); expect(listener).not.toHaveBeenCalled(); handler!({ taskId: 'owned', databaseDefaultEncoding: progress }); expect(listener).toHaveBeenCalledExactlyOnceWith({ taskId: 'owned', progress }); close(); expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
