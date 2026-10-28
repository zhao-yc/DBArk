import { describe, expect, it, vi } from 'vitest';
import { tableCheckRequiredAcknowledgements, type TableCheckChange, type TableCheckGetOutput, type TableCheckPreviewOutput, type TableCheckApplyOutput } from '../../src/shared/tableChecks';
import { assertTableCheckPreview, assertTableCheckSnapshot, TableCheckIntent, TableCheckResourceLedger, tableCheckAcknowledgementLabel, tableCheckAcksComplete, tableCheckExecutionState, tableCheckTokenCurrent } from '../../src/renderer/tableChecksUi';
import { assertTableChecksTargetAvailable } from '../../src/renderer/tableChecksServices';
const target = { connectionId: 'c', database: 'db', table: 'subject' }, change: TableCheckChange = { op: 'add', name: 'ck_amount', expression: '`amount` > 0', enforced: true };
function snapshot(): TableCheckGetOutput { return { target, snapshotId: 'snapshot', ddlHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60000).toISOString(), serverVersion: '8.4.11', dialect: 'mysql', sqlMode: '', coverage: 'complete', checks: [], columns: ['amount'], writable: true, allowsNotEnforced: true, reasons: [], warnings: [] }; }
function preview(original = snapshot()): TableCheckPreviewOutput { return { target, previewToken: 'preview', ddlHash: original.ddlHash, expiresAt: original.expiresAt, sql: 'ALTER TABLE `db`.`subject` ADD CONSTRAINT `ck_amount` CHECK (`amount` > 0)', change, requiredAcknowledgements: tableCheckRequiredAcknowledgements(change), warnings: [] }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
describe('CHECK前端身份、确认与资源责任', () => {
  it('准确目标/原DDL/单项草稿/TTL必须一致，不能通过名字猜测旧引用', () => {
    const original = snapshot(), plan = preview(original); expect(() => assertTableCheckPreview(plan, original, change)).not.toThrow();
    for (const bad of [{ ...plan, target: { ...target, table: 'Subject' } }, { ...plan, ddlHash: 'b'.repeat(64) }, { ...plan, change: { ...change, expression: '`amount` >= 0' } }, { ...plan, expiresAt: 'invalid' }]) expect(() => assertTableCheckPreview(bad, original, change)).toThrow();
    expect(() => assertTableCheckSnapshot({ ...original, expiresAt: '2000-01-01' }, target)).toThrow(); expect(tableCheckTokenCurrent('not-a-date')).toBe(false);
    expect(() => assertTableCheckPreview({ ...plan, change: { op: 'drop', checkRef: 'real-ref' }, requiredAcknowledgements: ['ddl-implicit-commit', 'external-ddl-window', 'check-removal'] }, original, { op: 'drop', checkRef: 'real-ref' })).toThrow();
  });
  it('确认集严格对应本次操作，未知/原型属性/重复/多余风险均不授权', () => {
    for (const value of [change, { op: 'drop', checkRef: 'ref' }, { op: 'replace', checkRef: 'ref', name: 'new', expression: 'amount > 1', enforced: false }, { op: 'enforcement', checkRef: 'ref', enforced: true }] as TableCheckChange[]) { const required = tableCheckRequiredAcknowledgements(value); expect(tableCheckAcksComplete(required, new Set(required), value)).toBe(true); expect(tableCheckAcksComplete([...required, required[0]], new Set(required), value)).toBe(false); expect(tableCheckAcksComplete(required, new Set([...required, 'unknown']), value)).toBe(false); expect(tableCheckAcksComplete(required.slice(1), new Set(required.slice(1)), value)).toBe(false); }
    expect(tableCheckAcknowledgementLabel('constructor')).toBeUndefined(); expect(tableCheckAcknowledgementLabel('__proto__')).toBeUndefined();
  });
  it.each(['profile', 'version', 'target'] as const)('%s变化后永久retire，A→B→A不能恢复原结构授权', which => {
    const profile = {}, state = { profile: profile as object | undefined, version: 1 }, intent = new TableCheckIntent(target, () => state);
    expect(intent.current()).toBe(true); if (which === 'profile') { state.profile = {}; intent.current(); state.profile = profile; } else if (which === 'version') { state.version = 2; intent.current(); state.version = 1; } else { intent.observe({ ...target, database: 'other' }); intent.observe(target); } expect(intent.current()).toBe(false);
  });
  it('同令牌去重释放，snapshot/preview同字面也不混淆，预览先于快照', async () => {
    const pending = deferred<void>(), send = vi.fn(async () => pending.promise), ledger = new TableCheckResourceLedger(send); ledger.track('snapshotId', 'same'); ledger.track('previewToken', 'same'); const one = ledger.release('previewToken', 'same'), two = ledger.release('previewToken', 'same'); await Promise.resolve(); expect(send).toHaveBeenCalledExactlyOnceWith({ previewToken: 'same' }); expect(ledger.size).toBe(2); pending.resolve(); await Promise.all([one, two]); expect(ledger.size).toBe(1);
    send.mockImplementation(async () => undefined); ledger.track('previewToken', 'new'); await ledger.releaseAll(); expect(send.mock.calls.slice(1)).toEqual([[{ previewToken: 'new' }], [{ snapshotId: 'same' }]]); expect(ledger.size).toBe(0);
  });
  it('某项释放失败仍尝试其它项，失败责任保留到明确重试成功', async () => {
    const send = vi.fn(async (value: { snapshotId?: string; previewToken?: string }) => { if (value.previewToken) throw Error('原Main释放失败'); }), ledger = new TableCheckResourceLedger(send); ledger.track('snapshotId', 'snapshot'); ledger.track('previewToken', 'preview'); await expect(ledger.releaseAll()).rejects.toThrow('原Main释放失败'); expect(send).toHaveBeenCalledTimes(2); expect(ledger.size).toBe(1); send.mockResolvedValue(undefined); await ledger.releaseAll(); expect(ledger.size).toBe(0);
  });
  it('只有完整返回且资源已结束才verified，rejection与取消不推断未执行', () => {
    expect(tableCheckExecutionState(false, null)).toEqual({ status: 'notSent', changed: false, verified: false }); expect(tableCheckExecutionState(true, null)).toEqual({ status: 'unknownOutcome', changed: true, verified: false });
    const progress = { phase: 'releasing' as const, ddlSubmitted: true, ddlCompleted: true, definitionVerified: false, outcome: 'succeeded' as const }; expect(tableCheckExecutionState(true, progress).status).toBe('unverified'); expect(tableCheckExecutionState(true, { ...progress, definitionVerified: true }).status).toBe('completed');
    const early = { ...progress, outcome: 'not-sent' as const, ddlSubmitted: false, ddlCompleted: false }; expect(tableCheckExecutionState(true, early).changed).toBe(true); expect(tableCheckExecutionState(true, early, undefined, true).changed).toBe(false);
    const result: TableCheckApplyOutput = { target, ddlSubmitted: true, ddlCompleted: true, definitionVerified: true, resourcesReleased: true, warnings: [] }; expect(tableCheckExecutionState(true, null, result).verified).toBe(true); expect(tableCheckExecutionState(true, null, { ...result, resourcesReleased: false } as unknown as TableCheckApplyOutput).verified).toBe(false);
  });
  it('精确保护同目标隐藏表页，own flags不误读原型，也不影响其它查询或同名异库', () => {
    const table = { id: 'hidden', kind: 'table' as const, title: 'subject', ...target }, state = { settings: { tabs: [table] }, dirtyTabs: { hidden: true }, activeJobs: {} }; expect(() => assertTableChecksTargetAvailable(target, state)).toThrow('草稿'); expect(() => assertTableChecksTargetAvailable({ ...target, database: 'DB' }, state)).not.toThrow(); expect(() => assertTableChecksTargetAvailable(target, { ...state, dirtyTabs: {}, activeJobs: { hidden: true } })).toThrow('活动操作'); expect(() => assertTableChecksTargetAvailable(target, { settings: { tabs: [{ ...table, id: 'constructor' }] }, dirtyTabs: {}, activeJobs: {} })).not.toThrow();
  });
});
