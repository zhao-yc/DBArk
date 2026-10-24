import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ResultExportData, TableInfo } from '../../src/shared/contracts';
import type { ResultInsertPreviewInput, ResultInsertProgress } from '../../src/shared/resultInsert';
import { ResultInsertSourceIntent, checkResultInsertApplied, checkResultInsertMapping, checkResultInsertPreview, mergeResultInsertProgress, suggestResultInsertMapping } from '../../src/renderer/resultInsertUi';

const data = (): ResultExportData => ({ columns: [{ key: 'a', name: '同名' }, { key: 'b', name: '同名' }, { key: 'id', name: 'id' }, { key: 'bytes', name: 'bytes' }], rows: [{ a: '0.12345678901234567890', b: '2026-10-24 00:00:00.123456', id: '18446744073709551615', bytes: { type: 'binary', base64: 'AP8=' } }], truncated: true });
const info = (): TableInfo => ({ database: 'db', name: 'dest', objectKind: 'table', engine: 'InnoDB', columns: ['id', '同名', 'bytes', 'computed', 'virtual'].map(name => ({ name, type: 'TEXT', nullable: true, defaultValue: null, extra: name === 'virtual' ? 'VIRTUAL GENERATED' : '', generated: name === 'computed', comment: '' })), primaryKey: [], editableKey: [], indexes: [], foreignKeys: [], ddl: '' });
const input = (): ResultInsertPreviewInput => ({ connectionId: 'target', database: 'db', table: 'dest', taskId: randomUUID(), data: data(), mapping: [{ source: 'id', target: 'id' }], timeZone: '+00:00' });
const output = (request = input()) => ({ previewToken: randomUUID(), target: { connectionId: request.connectionId, database: request.database, table: request.table }, rows: request.data.rows.length, mapping: request.mapping, shownRows: 1, sql: 'INSERT INTO `db`.`dest` (`id`) VALUES (1);', expiresAt: new Date(Date.now() + 60_000).toISOString(), definitionDigest: 'a'.repeat(64), sourceTruncated: true, timeZone: '+00:00', warnings: ['仅RAM样本'] });
const progress = (patch: Partial<ResultInsertProgress> = {}): ResultInsertProgress => ({ phase: 'inserting', rows: 0, totalRows: 1, dmlMayHaveBeenSent: false, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: true, outcome: 'not-sent', ...patch });

describe('结果插入UI完整快照与确认边界（纯本地）', () => {
  it('保留精确字符串、时间、二进制、NULL/空串并冻结，原对象事后变化不能改写待插入副本', () => {
    const source = data(), intent = new ResultInsertSourceIntent(source, true, randomUUID(), () => true), saved = structuredClone(source);
    source.rows[0].id = '0'; source.rows[0].bytes = null; source.columns.reverse(); expect(intent.data).toEqual(saved); expect(intent.selected).toBe(true); expect(Object.isFrozen(intent.data.rows[0])).toBe(true); expect(Object.isFrozen(intent.data.rows[0].bytes)).toBe(true);
    const nullable = new ResultInsertSourceIntent({ columns: [{ key: 'n', name: '' }], rows: [{ n: null }, { n: '' }, { n: 'NULL' }, { n: 'line\nbreak' }], truncated: false }, false, 'owner', () => true); expect(nullable.data.rows.map(row => row.n)).toEqual([null, '', 'NULL', 'line\nbreak']);
  });
  it('零行、Date、未确认精度的unsafe number和坏尾行都在任何目录/预览前拒绝', () => {
    for (const source of [{ ...data(), rows: [] }, { ...data(), rows: [{ ...data().rows[0], b: new Date() }] }, { ...data(), rows: [{ ...data().rows[0], id: 9007199254740992 }] }, { ...data(), rows: [data().rows[0], { ...data().rows[0], bytes: { type: 'binary', base64: '?' } }] }]) expect(() => new ResultInsertSourceIntent(source as never, false, 'owner', () => true)).toThrow();
  });
  it('重名标题不自动建议，唯一同名按内部key映射，生成列不可写且目标不重复', () => {
    expect(suggestResultInsertMapping(data(), info())).toEqual([{ source: 'id', target: 'id' }, { source: 'bytes', target: 'bytes' }]);
    expect(checkResultInsertMapping(data(), info(), [{ source: 'bytes', target: 'bytes' }, { source: 'a', target: '同名' }])).toEqual([{ source: 'a', target: '同名' }, { source: 'bytes', target: 'bytes' }]);
    for (const mapping of [[], [{ source: 'a', target: 'computed' }], [{ source: 'a', target: 'virtual' }], [{ source: 'a', target: 'missing' }], [{ source: 'missing', target: 'id' }], [{ source: 'a', target: 'id' }, { source: 'b', target: 'id' }], [{ source: 'a', target: 'id' }, { source: 'a', target: 'bytes' }]]) expect(() => checkResultInsertMapping(data(), info(), mapping)).toThrow();
  });
  it('源标签或owner失效是永久撤销，ABA不复活且只通知一次', () => {
    let allowed = true; const intent = new ResultInsertSourceIntent(data(), false, 'owner', () => allowed), listener = vi.fn(); intent.subscribe(listener); allowed = false; expect(intent.current()).toBe(false); allowed = true; expect(intent.current()).toBe(false); intent.invalidate(); expect(listener).toHaveBeenCalledOnce();
  });
  it('预览回证准确目标/行数/映射/时区/截断标志，不能把有限样本视为完整数据', () => {
    const request = input(), result = output(request); expect(checkResultInsertPreview(result, request)).toEqual(result);
    for (const patch of [{ rows: 2 }, { target: { ...result.target, table: 'other' } }, { mapping: [{ source: 'b', target: 'id' }] }, { timeZone: '+08:00' }, { sourceTruncated: false }, { shownRows: 2 }]) expect(() => checkResultInsertPreview({ ...result, ...patch }, request)).toThrow();
    expect(checkResultInsertApplied({ target: result.target, rows: 1, outcome: 'committed', commitAcknowledged: true }, result).rows).toBe(1); expect(() => checkResultInsertApplied({ target: result.target, rows: 2, outcome: 'committed', commitAcknowledged: true }, result)).toThrow();
  });
  it('提交ACK与COMMIT发送事实单调保留；回滚只有明确ACK+事务保护才可确认', () => {
    let fact = mergeResultInsertProgress(undefined, progress({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, phase: 'committing', outcome: 'unknown' }));
    fact = mergeResultInsertProgress(fact, progress({ commitAcknowledged: true, outcome: 'committed', phase: 'finished' }));
    fact = mergeResultInsertProgress(fact, progress()); expect(fact).toMatchObject({ dmlMayHaveBeenSent: true, commitMayHaveBeenSent: true, commitAcknowledged: true, outcome: 'committed' });
    expect(mergeResultInsertProgress(undefined, progress({ dmlMayHaveBeenSent: true, rollbackAcknowledged: true, transactionProtected: true, outcome: 'unknown' }))?.outcome).toBe('rolled-back');
    expect(mergeResultInsertProgress(undefined, { ...progress(), rows: NaN })).toBeUndefined();
    expect(mergeResultInsertProgress(undefined, progress({ commitAcknowledged: true, rows: 0, totalRows: 1, outcome: 'committed' }), 1)).toBeUndefined();
    expect(mergeResultInsertProgress(undefined, progress({ commitAcknowledged: true, rows: 1, totalRows: 1, outcome: 'committed' }), 1)?.outcome).toBe('committed');
  });
});
