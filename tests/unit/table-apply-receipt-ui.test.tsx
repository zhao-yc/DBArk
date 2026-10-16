import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyTableApplyEvidence, type TableApplyReceipt } from '../../src/shared/tableApplyReceipt';
import { TableApplyReceiptDetails } from '../../src/renderer/components/TableApplyReceiptsDialog';
describe('受限回执详情文案', () => {
  it('未知不显示零行成功，也没有重放按钮；目标/ID/时间和范围可见', () => {
    const r: TableApplyReceipt = { version: 1, operationId: 'operation', taskId: 'task', previewId: 'preview', target: { connectionId: 'old-connection', connectionRevision: 3, database: '<db>', table: 'subject' }, intent: { insert: 1, update: 0, delete: 0, statementCount: 1 }, phase: 'terminal', outcome: 'unknown', reason: 'interrupted', startedAt: '2026-10-16T00:00:00.000Z', finishedAt: '2026-10-16T00:00:01.000Z', sequence: 0, evidence: emptyTableApplyEvidence(), committedReportedRows: null, scope: 'target-transaction-only' };
    const html = renderToStaticMarkup(<TableApplyReceiptDetails receipt={r}/>);
    expect(html).toContain('operation'); expect(html).toContain('preview'); expect(html).toContain('&lt;db&gt;'); expect(html).toContain('结果未知'); expect(html).toContain('不是服务器提交时间'); expect(html).toContain('不包含触发器'); expect(html).toContain('不保存SQL'); expect(html).not.toContain('<button'); expect(html).not.toContain('影响 0 行');
  });
});
