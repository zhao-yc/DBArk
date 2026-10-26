import { describe, expect, it } from 'vitest';
import { publicCommands } from '../../src/shared/commands';
import { persistedTaskMessage } from '../../src/main/taskPrivacy';
import type { TaskEvent } from '../../src/shared/contracts';
import { tableFilteredDeleteApplyInputSchema, tableFilteredDeleteApplyOutputSchema, tableFilteredDeleteConfirmation, tableFilteredDeleteLimits, tableFilteredDeletePreviewInputSchema, tableFilteredDeletePreviewOutputSchema, tableFilteredDeleteProgressSchema, tableFilteredDeleteReleaseInputSchema, tableFilteredDeleteScopeIdentity, tableFilteredDeleteVersionSupported } from '../../src/shared/tableFilteredDelete';

const taskId = '00000000-0000-4000-8000-000000000001', token = '00000000-0000-4000-8000-000000000002';
const target = { connectionId: 'connection', database: '资料库', table: '原表' };
const preview = () => ({ ...target, taskId, metadataKey: '原定义', filters: [{ column: 'amount', operator: '=' as const, value: '123456789012345678.123456', enabled: false }], filterMode: 'all' as const, sort: [{ column: 'id', direction: 'DESC' as const }] });
const output = () => ({ operation: 'delete' as const, previewToken: token, target, rows: 61, shownRows: 10, sql: 'DELETE 样本', sampleOmitted: true, expiresAt: '2026-10-26T12:00:00.000Z', definitionDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64), timeZone: '+08:00', warnings: [] });
const progress = () => ({ phase: 'deleting' as const, rows: 30, totalRows: 61, snapshotBytes: 200, dmlMayHaveBeenSent: true, commitMayHaveBeenSent: false, commitAcknowledged: false, rollbackAcknowledged: false, transactionProtected: true, outcome: 'unknown' as const });

describe('全部筛选行删除共享契约', () => {
  it.each(['8.0.46','8.4.11','8.0.46-commercial','8.4.11 MySQL Community Server'])('仅开放已验MySQL版本 %s',version=>{
    expect(tableFilteredDeleteVersionSupported('mysql',version)).toBe(true);
  });
  it.each(['','5.7.44','8.0.45','8.0.460','8.4.12','9.0.0','8.4.11garbage','10.11.19-MariaDB','5.5.5-11.4.13-MariaDB'])('未证明的版本 %s 不推测支持',version=>{
    expect(tableFilteredDeleteVersionSupported('mysql',version)).toBe(false);expect(tableFilteredDeleteVersionSupported('mariadb',version)).toBe(false);
  });
  it('方言不能由版本数字或调用方伪装',()=>{expect(tableFilteredDeleteVersionSupported('mariadb','8.4.11')).toBe(false);expect(tableFilteredDeleteVersionSupported('unknown','8.0.46')).toBe(false);});
  it('专用IPC白名单不借用任意SQL或填充命令', () => {
    expect(publicCommands['table.filteredDelete.preview']).toBe(true);
    expect(publicCommands['table.filteredDelete.apply']).toBe(true);
    expect(publicCommands['table.filteredDelete.release']).toBe(true);
  });
  it('完整保留停用条件、原精度和排序，不携带当前页数据', () => {
    const value = tableFilteredDeletePreviewInputSchema.parse(preview());
    expect(value.filters[0]).toMatchObject({ value: '123456789012345678.123456', enabled: false });
    expect(value.sort).toEqual([{ column: 'id', direction: 'DESC' }]);
  });
  it.each(['sql', 'page', 'offset', 'limit', 'rows', 'values', 'column', 'value', 'profile', 'connectionRevision'])('拒绝调用方注入 %s', key => {
    expect(tableFilteredDeletePreviewInputSchema.safeParse({ ...preview(), [key]: '不准注入' }).success).toBe(false);
  });
  it.each(['', 'bad', '00000000-0000-4000-8000-000000000000-not-uuid'])('拒绝无效任务编号 %s', taskId => {
    expect(tableFilteredDeletePreviewInputSchema.safeParse({ ...preview(), taskId }).success).toBe(false);
  });
  it('拒绝重复排序字段', () => {
    expect(tableFilteredDeletePreviewInputSchema.safeParse({ ...preview(), sort: [{ column: 'id', direction: 'ASC' }, { column: 'id', direction: 'DESC' }] }).success).toBe(false);
  });
  it('拒绝未知条件树、访问器及循环，不调用getter', () => {
    let reads = 0;
    const value = preview(); Object.defineProperty(value, 'filters', { enumerable: true, get: () => { reads++; return []; } });
    expect(tableFilteredDeletePreviewInputSchema.safeParse(value).success).toBe(false); expect(reads).toBe(0);
    const cyclic: Record<string, unknown> = { ...preview() }; cyclic.filterGroup = cyclic;
    expect(tableFilteredDeletePreviewInputSchema.safeParse(cyclic).success).toBe(false);
    expect(tableFilteredDeletePreviewInputSchema.safeParse({ ...preview(), filterGroup: { kind: 'unknown' } }).success).toBe(false);
  });
  it.each(['\0bad', '\ud800', 'x'.repeat(65)])('拒绝不可解释的目标名', table => {
    expect(tableFilteredDeletePreviewInputSchema.safeParse({ ...preview(), table }).success).toBe(false);
  });
  it('范围身份包含完整停用条件、模式、分组与排序，缺省模式规范为all', () => {
    const original = tableFilteredDeletePreviewInputSchema.parse(preview());
    const value = tableFilteredDeleteScopeIdentity(original);
    expect(value).toBe(JSON.stringify(['原定义', original.filters, 'all', null, original.sort]));
    expect(tableFilteredDeleteScopeIdentity({ ...original, filterMode: undefined })).toBe(value);
    for (const changed of [{ ...original, metadataKey: '换表定义' }, { ...original, filters: [] }, { ...original, filterMode: 'any' as const }, { ...original, sort: [] }]) expect(tableFilteredDeleteScopeIdentity(changed)).not.toBe(value);
  });
  it('确认文本明确删除与准确对象、总数，原名仅做原文比较', () => {
    expect(tableFilteredDeleteConfirmation({ target, rows: 61 })).toBe('资料库.原表 / 删除 / 61');
  });
  it('申请、释放及成功回执都要求独立删除用途', () => {
    expect(tableFilteredDeleteApplyInputSchema.parse({ connectionId: target.connectionId, taskId, previewToken: token, confirmation: '资料库.原表 / 删除 / 61', acknowledged: true })).toMatchObject({ acknowledged: true });
    expect(tableFilteredDeleteApplyInputSchema.safeParse({ connectionId: target.connectionId, taskId, previewToken: token, confirmation: '确认', acknowledged: false }).success).toBe(false);
    expect(tableFilteredDeleteReleaseInputSchema.parse({ connectionId: target.connectionId, previewToken: token })).toEqual({ connectionId: target.connectionId, previewToken: token });
    expect(tableFilteredDeleteApplyOutputSchema.safeParse({ target, rows: 61, outcome: 'committed', commitAcknowledged: true }).success).toBe(false);
    expect(tableFilteredDeleteApplyOutputSchema.parse({ operation: 'delete', target, rows: 61, outcome: 'committed', commitAcknowledged: true }).rows).toBe(61);
  });
  it.each([{ rows: -1 }, { rows: Number.MAX_SAFE_INTEGER + 1 }, { shownRows: 11 }, { sql: 'x'.repeat(tableFilteredDeleteLimits.previewSqlBytes + 1) }, { operation: 'update' }, { column: '不属于删除回执' }])('拒绝越界或串用途回执', patch => {
    expect(tableFilteredDeletePreviewOutputSchema.safeParse({ ...output(), ...patch }).success).toBe(false);
  });
  it('进度仅允许删除阶段与完整事务事实', () => {
    expect(tableFilteredDeleteProgressSchema.parse(progress())).toEqual(progress());
    expect(tableFilteredDeleteProgressSchema.safeParse({ ...progress(), phase: 'updating' }).success).toBe(false);
    expect(tableFilteredDeleteProgressSchema.safeParse({ ...progress(), snapshotBytes: tableFilteredDeleteLimits.spoolBytes + 1 }).success).toBe(false);
  });
});

describe('全部筛选行删除的持久摘要隐私', () => {
  const event = (patch: Partial<TaskEvent> = {}): TaskEvent => ({ taskId, status: 'running', progress: 1, message: 'secret: 条件=保密值; SQL DELETE; 路径C:/private/spool', ...patch });
  it.each(['preview', 'apply', 'release'])('专用%s摘要不持久化输入、路径或服务端错误', action => {
    expect(persistedTaskMessage('table.filteredDelete.' + action, event())).not.toMatch(/secret|保密值|C:\/private|DELETE/);
  });
  it('已确认COMMIT优先于迟到失败、取消及未知', () => {
    expect(persistedTaskMessage('table.filteredDelete.apply', event({ status: 'failed', tableFilteredDelete: { ...progress(), commitMayHaveBeenSent: true, commitAcknowledged: true } }))).toContain('事务已确认提交');
  });
  it('只有事务保护且收到ROLLBACK ACK时记录整批回滚', () => {
    expect(persistedTaskMessage('table.filteredDelete.apply', event({ tableFilteredDelete: { ...progress(), rollbackAcknowledged: true, outcome: 'rolled-back' } }))).toContain('已确认整批回滚');
    expect(persistedTaskMessage('table.filteredDelete.apply', event({ tableFilteredDelete: { ...progress(), rollbackAcknowledged: true, transactionProtected: false } }))).toContain('结果未知');
  });
});
