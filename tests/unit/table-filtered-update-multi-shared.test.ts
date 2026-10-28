import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { tableFilteredUpdateApplyInputSchema, tableFilteredUpdateApplyOutputSchema, tableFilteredUpdateAssignments, tableFilteredUpdateConfirmation, tableFilteredUpdateLimits as limits, tableFilteredUpdateOutputColumns, tableFilteredUpdatePreviewInputSchema, tableFilteredUpdatePreviewOutputSchema } from '../../src/shared/tableFilteredUpdate';

/** 多字段用新形状，旧单字段fixture仍由原共享测试完整覆盖。 */
function input(assignments: unknown = [{ column: 'note', value: '完整原文\0🚢' }, { column: 'amount', value: '18446744073709551615.000000000001' }]) {
  return { connectionId: 'offline', database: 'db', table: 'subject', taskId: randomUUID(), metadataKey: '可信元数据', filters: [], sort: [], assignments };
}
function preview() {
  return { previewToken: randomUUID(), target: { connectionId: 'offline', database: 'db', table: 'subject' }, columns: ['note', 'amount'], rows: 20, shownRows: 10, sql: 'UPDATE 有界样本', sampleOmitted: true, expiresAt: new Date(Date.now() + 600000).toISOString(), definitionDigest: 'a'.repeat(64), assignmentDigest: 'b'.repeat(64), timeZone: '+08:00', warnings: [] };
}
function applied() { return { target: preview().target, columns: ['note', 'amount'], rows: 20, outcome: 'committed' as const, commitAcknowledged: true as const }; }

describe('全部筛选行多字段共享契约', () => {
  it('完整保留顺序和原值并克隆每项及二进制对象，旧单列helper仍可用', () => {
    const original = input([{ column: 'note', value: '保留原文' }, { column: 'binary', value: { type: 'binary', base64: 'AP8=' } }]);
    const parsed = tableFilteredUpdatePreviewInputSchema.parse(original), assignments = tableFilteredUpdateAssignments(parsed);
    expect(assignments).toEqual(original.assignments); expect(assignments).not.toBe(original.assignments);
    expect(assignments[1]).not.toBe(tableFilteredUpdateAssignments(parsed)[1]);
    const binary = assignments[1]!.value;
    if (binary && typeof binary === 'object') binary.base64 = '';
    expect(tableFilteredUpdateAssignments(parsed)[1]!.value).toEqual({ type: 'binary', base64: 'AP8=' });
    const legacy = { column: 'note', value: '旧协议' }; expect(tableFilteredUpdateAssignments(legacy)).toEqual([legacy]);
    expect(tableFilteredUpdateOutputColumns({ column: 'note' })).toEqual(['note']);
  });

  it('拒绝空组、超界、重复字段、缺项、未知字段和混合协议，单项新组保持新形状', () => {
    const valid = input([{ column: 'note', value: null }]); expect(tableFilteredUpdatePreviewInputSchema.parse(valid)).toEqual(valid);
    for (const invalid of [input([]), input(Array.from({ length: limits.columns + 1 }, (_, index) => ({ column: `c${index}`, value: null }))), input([{ column: 'note', value: 1 }, { column: 'note', value: 2 }]), input([{ column: 'note' }]), input([{ column: 'note', value: null, sql: '恶意扩展' }]), { ...input(), column: 'note', value: null }, { ...input(), column: undefined }, { ...input(), value: undefined }, { ...input(), assignments: undefined }]) expect(tableFilteredUpdatePreviewInputSchema.safeParse(invalid).success).toBe(false);
    expect(() => tableFilteredUpdateAssignments({ ...input(), column: '混合', value: null } as never)).toThrow();
  });

  it('1024个二进制赋值在派生节点预算内，筛选的既有预算也保留', () => {
    const assignments = Array.from({ length: limits.columns }, (_, index) => ({ column: `c${index}`, value: { type: 'binary', base64: '' } }));
    const request = { ...input(assignments), filters: Array.from({ length: 5 }, (_, index) => ({ column: `key${index}`, operator: 'IN', values: Array.from({ length: 200 }, (_, value) => String(value)) })) };
    expect(tableFilteredUpdatePreviewInputSchema.safeParse(request).success).toBe(true);
  });

  it('按UTF8和二进制实际字节限制单值8MiB及整组16MiB，标量也占预算', () => {
    const exact = 'a'.repeat(limits.fieldBytes), half = 'b'.repeat(limits.fieldBytes / 2);
    expect(tableFilteredUpdatePreviewInputSchema.safeParse(input([{ column: 'a', value: exact }, { column: 'b', value: exact }])).success).toBe(true);
    expect(tableFilteredUpdatePreviewInputSchema.safeParse(input([{ column: 'a', value: exact }, { column: 'b', value: exact }, { column: 'c', value: null }])).success).toBe(true);
    for (const value of [input([{ column: 'a', value: exact }, { column: 'b', value: exact }, { column: 'c', value: true }]), input([{ column: 'a', value: exact }, { column: 'b', value: exact }, { column: 'c', value: 0 }]), input([{ column: 'a', value: '界'.repeat(Math.floor(limits.fieldBytes / 3) + 1) }]), input([{ column: 'a', value: exact }, { column: 'b', value: half }, { column: 'c', value: half + 'a' }])]) expect(tableFilteredUpdatePreviewInputSchema.safeParse(value).success).toBe(false);
    const binary = { type: 'binary', base64: Buffer.alloc(limits.fieldBytes).toString('base64') };
    expect(tableFilteredUpdatePreviewInputSchema.safeParse(input([{ column: 'a', value: binary }, { column: 'b', value: binary }])).success).toBe(true);
    expect(tableFilteredUpdatePreviewInputSchema.safeParse(input([{ column: 'a', value: binary }, { column: 'b', value: binary }, { column: 'c', value: 'a' }])).success).toBe(false);
  });

  it('赋值和二进制中的访问器、隐藏、继承、稀疏及循环均不执行或接纳', () => {
    const getter = vi.fn(() => '访问器'), item = { column: 'note', value: null };
    Object.defineProperty(item, 'value', { get: getter, enumerable: true });
    const hidden = { column: 'note', value: null }; Object.defineProperty(hidden, 'value', { value: null, enumerable: false });
    const binary = { type: 'binary', base64: '' }; Object.defineProperty(binary, 'base64', { get: getter, enumerable: true });
    const sparse = Array(1); Object.defineProperty(sparse, 'extra', { value: { column: 'note', value: null }, enumerable: true });
    const cycle: unknown[] = []; cycle.push(cycle);
    for (const assignments of [[item], [hidden], [Object.assign(Object.create({ value: null }), { column: 'note' })], [{ column: 'note', value: binary }], sparse, cycle]) expect(tableFilteredUpdatePreviewInputSchema.safeParse(input(assignments)).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('预览和提交回证严格列集合union，不接纳值、混合形状、空组、重复或越界列集合', () => {
    const result = preview(), output = applied(); expect(tableFilteredUpdatePreviewOutputSchema.parse(result)).toEqual(result); expect(tableFilteredUpdateApplyOutputSchema.parse(output)).toEqual(output);
    const columns = tableFilteredUpdateOutputColumns(result); columns[0] = '被改动'; expect(result.columns).toEqual(['note', 'amount']);
    for (const change of [{ column: 'note' }, { column: undefined }, { value: '禁止泄露' }, { values: ['禁止泄露'] }, { assignments: [{ column: 'note', value: '禁止泄露' }] }, { columns: [] }, { columns: ['note', 'note'] }, { columns: Array.from({ length: limits.columns + 1 }, (_, index) => `c${index}`) }]) {
      expect(tableFilteredUpdatePreviewOutputSchema.safeParse({ ...result, ...change }).success).toBe(false);
      expect(tableFilteredUpdateApplyOutputSchema.safeParse({ ...output, ...change }).success).toBe(false);
    }
    const { columns: omittedPreview, ...legacyPreview } = result, { columns: omittedApply, ...legacyApply } = output;
    expect(tableFilteredUpdatePreviewOutputSchema.parse({ ...legacyPreview, column: 'note' })).toEqual({ ...legacyPreview, column: 'note' });
    expect(tableFilteredUpdateApplyOutputSchema.parse({ ...legacyApply, column: 'note' })).toEqual({ ...legacyApply, column: 'note' });
    const getter = vi.fn(() => 'note'), badColumns = ['note']; Object.defineProperty(badColumns, '0', { get: getter, enumerable: true });
    expect(tableFilteredUpdatePreviewOutputSchema.safeParse({ ...result, columns: badColumns }).success).toBe(false);
    expect(tableFilteredUpdateApplyOutputSchema.safeParse({ ...output, columns: badColumns }).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it('多列确认使用完整JSON列列表并支持1024列，旧单字段确认原文不变', () => {
    const target = { connectionId: 'offline', database: '库', table: '表' }, columns = ['字段 / 另一字段', '引号"换行\n', '末尾'];
    expect(tableFilteredUpdateConfirmation({ target, columns, rows: 12 })).toBe(`库.表 / ${JSON.stringify(columns)} / 12`);
    expect(tableFilteredUpdateConfirmation({ target, column: columns[0]!, rows: 12 })).toBe('库.表 / 字段 / 另一字段 / 12');
    const longColumns = Array.from({ length: limits.columns }, (_, index) => `${'列'.repeat(55)}${index}`), confirmation = tableFilteredUpdateConfirmation({ target, columns: longColumns, rows: 12 });
    const apply = { connectionId: 'offline', taskId: randomUUID(), previewToken: randomUUID(), confirmation, acknowledged: true };
    expect(confirmation.length).toBeGreaterThan(300); expect(tableFilteredUpdateApplyInputSchema.safeParse(apply).success).toBe(true);
    expect(tableFilteredUpdateApplyInputSchema.safeParse({ ...apply, confirmation: 'a'.repeat(limits.confirmationBytes) }).success).toBe(true);
    for (const confirmation of ['a'.repeat(limits.confirmationBytes + 1), '界'.repeat(Math.floor(limits.confirmationBytes / 3) + 1), '\ud800']) expect(tableFilteredUpdateApplyInputSchema.safeParse({ ...apply, confirmation }).success).toBe(false);
  });

  it('1024个合法唯一控制字符列名的最坏JSON表示仍可完整确认提交', () => {
    // U+0001被JSON编码为六字节，不能仅按未转义名称的UTF8大小设计确认上限。
    const columns = Array.from({ length: limits.columns }, (_, index) => `${'\u0001'.repeat(60)}${String(index).padStart(4, '0')}`);
    const request = tableFilteredUpdatePreviewInputSchema.parse(input(columns.map(column => ({ column, value: null }))));
    expect(tableFilteredUpdateAssignments(request).map(assignment => assignment.column)).toEqual(columns);
    const receipt = tableFilteredUpdatePreviewOutputSchema.parse({ ...preview(), columns }), confirmation = tableFilteredUpdateConfirmation(receipt);
    expect(tableFilteredUpdateOutputColumns(receipt)).toEqual(columns);
    expect(Buffer.byteLength(confirmation, 'utf8')).toBeGreaterThan(256 * 1024);
    expect(Buffer.byteLength(confirmation, 'utf8')).toBeLessThanOrEqual(limits.confirmationBytes);
    const apply = { connectionId: request.connectionId, taskId: randomUUID(), previewToken: receipt.previewToken, confirmation, acknowledged: true };
    expect(tableFilteredUpdateApplyInputSchema.parse(apply)).toEqual(apply);
    expect(tableFilteredUpdateOutputColumns(tableFilteredUpdateApplyOutputSchema.parse({ ...applied(), columns }))).toEqual(columns);
    expect(tableFilteredUpdateApplyInputSchema.safeParse({ ...apply, confirmation: 'a'.repeat(limits.confirmationBytes + 1) }).success).toBe(false);
  });
});
