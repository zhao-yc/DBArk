import { describe, expect, it } from 'vitest';

// 导入真实消费者；不执行CLI，不启动应用、网络或安装程序。
const runner: any = await import(new URL('../../scripts/v028-keyword-native-ci.mjs', import.meta.url).href);
/** 原报告形状的公开合成终态，用于验证清理授权必须包含全部证据。 */
function report() {
  return { errors: [], suites: [{ specs: ['upper', 'lower'].map(restoredCase => {
    const proof = { accepted: true, restoredCase, schema: 9, restart: { activeTabId: '公开合成ID', paneIndex: 0, editor: 1, model: 2 }, owners: [0, 1].map(() => ({ confirmed: true, willQuit: true, closed: true, recordedPids: 3 })), lateModule: { held: 1, delivered: 1, detached: true, failed: false, contextRoundTrip: true }, directoryRemoved: true, systemClipboard: 0, sqlExecution: 0 };
    return { file: 'sql-keyword-case-native.spec.ts', ok: true, tests: [{ expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [], attachments: [{ name: '关键字原生终态', contentType: 'application/json', body: Buffer.from(JSON.stringify(proof)).toString('base64') }] }] }] };
  }) }] };
}

describe('0.28关键字原报告的独立消费', () => {
  it('原两例与四正常owner齐全才允许通过', () => { expect(runner.assertKeywordReport(report())).toHaveLength(2); });
  it.each(['retry', 'duplicate', 'missing', 'wrong-file', 'error'])('拒绝%s报告而不补证', mode => {
    const value = report(), entry = value.suites[0].specs[0], result = entry.tests[0].results[0];
    if (mode === 'retry') result.retry = 1;
    if (mode === 'duplicate') value.suites[0].specs.push(entry);
    if (mode === 'missing') result.attachments = [];
    if (mode === 'wrong-file') entry.file = '另一个目录/sql-keyword-case-native.spec.ts';
    if (mode === 'error') result.errors = [{}] as never[];
    expect(() => runner.assertKeywordReport(value)).toThrow();
  });
  it.each(['owner', 'schema', 'late', 'cleanup', 'mode', 'restart'])('拒绝%s终态缺口而不授权安装清理', mode => {
    const value = report(), attachment = value.suites[0].specs[0].tests[0].results[0].attachments[0];
    const proof = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    if (mode === 'owner') proof.owners[1].closed = false;
    if (mode === 'schema') proof.schema = 8;
    if (mode === 'late') proof.lateModule.delivered = 0;
    if (mode === 'cleanup') proof.directoryRemoved = false;
    if (mode === 'mode') proof.restoredCase = 'lower';
    if (mode === 'restart') proof.restart.activeTabId = '';
    attachment.body = Buffer.from(JSON.stringify(proof)).toString('base64');
    expect(() => runner.assertKeywordReport(value)).toThrow();
  });
});
