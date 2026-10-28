import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TableChecksMainCapabilities, tableChecksFailureProgress } from '../../src/main/tableChecksMainCapabilities';
import type { ColumnsInvocation } from '../../src/main/columnsMainCapabilities';

type Token = { purpose: string; connectionId: string; expires: number; kind: 'snapshot' | 'preview'; snapshotId?: string };
const target = { connectionId: 'c', database: 'db', table: 'subject' };
it('Main未获终态的投递失败不能继承早期running not-sent；真正OK事实仍保留', () => {
  const early = { phase: 'rechecking' as const, ddlSubmitted: false, ddlCompleted: false, definitionVerified: false, outcome: 'not-sent' as const };
  expect(tableChecksFailureProgress(false, early).outcome).toBe('not-sent');
  expect(tableChecksFailureProgress(true, early)).toEqual({ ...early, ddlSubmitted: true, outcome: 'unknown' });
  expect(tableChecksFailureProgress(true).outcome).toBe('unknown');
  expect(tableChecksFailureProgress(false).outcome).toBe('not-sent');
  expect(tableChecksFailureProgress(false, { ...early, ddlSubmitted: true, outcome: 'unknown' }).outcome).toBe('unknown');
  expect(tableChecksFailureProgress(true, { ...early, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' })).toMatchObject({ ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, outcome: 'succeeded' });
  expect(tableChecksFailureProgress(true, { ...early, definitionVerified: true }).definitionVerified).toBe(false);
});
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(100000); });
afterEach(() => { vi.useRealTimers(); });
/** 真实IPC捕获属于外部端口；这里只提供不可伪造的测试owner和单调文档/配置代次。 */
function fixture() {
  let document = {}, revision = 1, closing = false, locked = false, seq = 0;
  const owners = new Set<ColumnsInvocation>(), tokens = new Map<string, Token>(), release = vi.fn(async (_input: { snapshotId?: string; previewToken?: string }) => {});
  const assertOwner = (owner?: ColumnsInvocation) => { if (!owner || !owners.has(owner) || owner.owner.document !== document) throw Error('真实来源已变化'); };
  const runtime = { assertOwner, sameOwner(left: ColumnsInvocation, right: ColumnsInvocation) { assertOwner(left); assertOwner(right); return left.owner.document === right.owner.document; }, revision: () => revision, available() { if (locked) throw Error('配置正在修改'); }, closing: () => closing, release };
  const helper = new TableChecksMainCapabilities(tokens, runtime);
  const owner = () => { const value = { owner: { document } } as ColumnsInvocation; owners.add(value); return value; };
  const reply = (kind: 'snapshot' | 'preview', token: string, override = {}) => ({ target, expiresAt: new Date(Date.now() + 60000).toISOString(), [kind === 'snapshot' ? 'snapshotId' : 'previewToken']: token, ...override });
  const get = () => { const request = helper.begin('schema.tableChecks.get', target, owner()), id = 's' + ++seq; helper.beforeSend(request, revision); helper.publish(request, reply('snapshot', id)); helper.assertReply(request); return { request, id }; };
  const preview = (snapshotId: string) => { const request = helper.begin('schema.tableChecks.preview', { snapshotId }, owner()), id = 'p' + ++seq; helper.beforeSend(request, revision); helper.publish(request, reply('preview', id)); helper.assertReply(request); return { request, id }; };
  return { helper, tokens, release, owner, reply, get, preview, rotate: () => { document = {}; }, revise: () => { revision++; }, close: () => { closing = true; }, lock: () => { locked = true; } };
}

it('绑定真实来源、用途、原目标和父对象，未知及伪造能力不能投递', () => {
  const f = fixture(); expect(() => f.helper.begin('schema.tableChecks.get', target, {} as ColumnsInvocation)).toThrow('来源');
  expect(() => f.helper.begin('schema.tableChecks.get', target)).toThrow();
  expect(() => f.helper.begin('schema.columns.get', target, f.owner())).toThrow();
  const first = f.get(); f.preview(first.id); f.tokens.set('forged', { purpose: 'tableChecks', connectionId: 'c', kind: 'snapshot', expires: 160000 });
  expect(() => f.preview('forged')).toThrow(); f.tokens.set('other', { purpose: 'indexes', connectionId: 'c', kind: 'snapshot', expires: 160000 }); expect(() => f.preview('other')).toThrow();
  const record = f.tokens.get(first.id)!; f.tokens.set(first.id, { ...record }); expect(() => f.preview(first.id)).toThrow();
});
it('旧文档、配置修订、关闭和配置锁在准备/真正投递/发布均不能复活', () => {
  for (const action of ['rotate', 'revise', 'close', 'lock'] as const) { const f = fixture(), original = f.get(), request = f.helper.begin('schema.tableChecks.preview', { snapshotId: original.id }, f.owner()); f[action](); expect(() => f.helper.beforeSend(request, 1)).toThrow(); expect(() => f.helper.publish(request, f.reply('preview', 'late'))).toThrow(); }
});
it('源快照被删除后同ID重放及晚预览均拒绝，不能挪用其它表结果', async () => {
  const f = fixture(), first = f.get(), request = f.helper.begin('schema.tableChecks.preview', { snapshotId: first.id }, f.owner()); f.tokens.delete(first.id);
  expect(() => f.helper.publish(request, f.reply('preview', 'late'))).toThrow(); await expect(f.helper.rejectReply(request, Error('原请求失效'))).rejects.toThrow('原请求失效'); expect(f.release).toHaveBeenCalledWith({ previewToken: 'late' });
  const second = f.helper.begin('schema.tableChecks.get', target, f.owner()); expect(() => f.helper.publish(second, f.reply('snapshot', 'wrong', { target: { ...target, table: 'other' } }))).toThrow(); await expect(f.helper.rejectReply(second, Error('目标变化'))).rejects.toThrow(); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'wrong' });
});
it('apply同步消费父与所有兄弟预览，原领取只投递一次，不给旧快照再生成能力', () => {
  const f = fixture(), first = f.get(), one = f.preview(first.id), two = f.preview(first.id), request = f.helper.begin('schema.tableChecks.apply', { previewToken: one.id }, f.owner());
  expect(f.tokens.size).toBe(0); f.helper.beforeSend(request, 1); f.helper.assertReply(request, { target });
  expect(() => f.helper.begin('schema.tableChecks.apply', { previewToken: one.id }, f.owner())).toThrow(); expect(() => f.helper.begin('schema.tableChecks.apply', { previewToken: two.id }, f.owner())).toThrow(); expect(() => f.preview(first.id)).toThrow();
  expect(() => f.helper.assertReply(request, { target: { ...target, database: 'other' } })).toThrow();
});
it('过期和过期后重新发布不能扩大TTL；重复引擎token不覆盖或释放其它能力', async () => {
  const f = fixture(), one = f.get(); vi.setSystemTime(160001); expect(() => f.preview(one.id)).toThrow();
  const request = f.helper.begin('schema.tableChecks.get', target, f.owner()); expect(() => f.helper.publish(request, f.reply('snapshot', 'new', { expiresAt: new Date(Date.now() + 120001).toISOString() }))).toThrow();
  await expect(f.helper.rejectReply(request, Error('期限错误'))).rejects.toThrow(); expect(f.release).toHaveBeenCalledWith({ snapshotId: 'new' });
  const two = f.get(), duplicate = f.helper.begin('schema.tableChecks.get', target, f.owner()); expect(() => f.helper.publish(duplicate, f.reply('snapshot', two.id))).toThrow(); f.release.mockClear(); await expect(f.helper.rejectReply(duplicate, Error('重复'))).rejects.toThrow(); expect(f.release).not.toHaveBeenCalled(); expect(f.tokens.has(two.id)).toBe(true);
});
it('IPC最后同步门失败精确回收未交付结果，清理错误保持可见', async () => {
  const f = fixture(), one = f.get(); expect(f.helper.hasUnpublished(one.request)).toBe(true); f.rotate(); expect(() => f.helper.assertReply(one.request)).toThrow();
  f.release.mockRejectedValueOnce(Error('原引擎未确认释放')); await expect(f.helper.rejectReply(one.request, Error('原文档失效'))).rejects.toThrow('释放尚未确认'); expect(f.tokens.has(one.id)).toBe(false); expect(f.helper.hasUnpublished(one.request)).toBe(false);
});
it('先校验全部释放输入再撤销，错用途/错类型不影响原能力；未知ID不送Engine', async () => {
  const f = fixture(), one = f.get(), preview = f.preview(one.id); f.tokens.set('other', { purpose: 'indexes', connectionId: 'c', kind: 'preview', expires: 160000 });
  const request = () => f.helper.begin('schema.tableChecks.release', {}, f.owner());
  await expect(f.helper.release(request(), { snapshotId: one.id, previewToken: 'other' })).rejects.toThrow(); expect(f.tokens.has(one.id)).toBe(true); expect(f.tokens.has(preview.id)).toBe(true); expect(f.release).not.toHaveBeenCalled();
  await f.helper.release(request(), { snapshotId: 'unknown' }); expect(f.release).not.toHaveBeenCalled();
  await f.helper.release(request(), { snapshotId: one.id }); expect(f.tokens.has(one.id)).toBe(false); expect(f.tokens.has(preview.id)).toBe(false); expect(f.tokens.has('other')).toBe(true); expect(f.release).toHaveBeenCalledWith({ snapshotId: one.id });
  await f.helper.release(request(), { snapshotId: one.id }); expect(f.release).toHaveBeenCalledTimes(2);
});
