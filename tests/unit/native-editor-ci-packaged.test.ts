import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { fileFirstModelCases } from '../helpers/queryFileFirstModelNative';
import { firstModelProof } from '../fixtures/native-file-first-model-ci';

const runner: any = await import(new URL('../../scripts/native-editor-ci.mjs', import.meta.url).href);
const fileRunner: any = await import(new URL('../../scripts/native-file-first-model-ci.mjs', import.meta.url).href);
const source = readFileSync(new URL('../../scripts/test-packaged.mjs', import.meta.url), 'utf8');
const tree = ts.createSourceFile('test-packaged.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const execution = tree.statements.find(ts.isTryStatement);
if (!execution?.catchClause || !execution.finallyBlock) throw Error('缺少真实安装测试try/catch/finally');
const program = ts.transpileModule(execution.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

/** 执行原安装脚本整个收尾控制块；安装、运行与删除只用RAM端口记录，从不接触系统安装。 */
async function probe(mode: 'native-failed' | 'later-failed' | 'accepted' | 'approval-failed' | 'first-model-failed' | 'first-model-unknown' | 'first-model-footer-bad', keeper: 'off' | 'accepted' | 'failed' = 'off') {
  const cleanup = vi.fn(), install = vi.fn(() => '/owned/Applications/DBArk.app/Contents/MacOS/DBArk');
  const native = vi.fn(() => { if (mode === 'native-failed') throw Error('原专项失败'); return { cleanupAllowed: true, proofs: [{}, {}] }; });
  const firstModel = vi.fn(() => {
    if (mode === 'first-model-failed') throw Error('原四例失败');
    if (mode === 'first-model-unknown') return undefined;
    const proofs = fileFirstModelCases.map(value => firstModelProof(value)); if (mode === 'first-model-footer-bad') proofs[0].sqliteSchema = 8;
    return { phase: 'installed', cleanupAllowed: true, proofs };
  });
  const context: any = {
    macCleanupNonce: keeper === 'off' ? undefined : 'a'.repeat(64),
    confirmMacInstalledCleanup: vi.fn(async () => { if (keeper === 'failed') throw Error('显示租约恢复未知'); }),
    process: { env: { DBARK_NATIVE_EDITOR_CI: '1' }, execPath: '/RAM/node' }, platform: 'darwin', project: '/project', artifact: '/project/release/input.dmg', temporary: '/owned', mountDirectory: '/owned/mount', applicationDirectory: '/owned/Applications', nativeEnabled: true, nativeResult: undefined, fileFirstModelResult: undefined, installAttempted: true, testFailure: undefined,
    preparePackageIdentity: () => { if (mode === 'approval-failed') throw Error('批准失败'); return {}; }, ciContext: () => ({}), approveInstalled: () => ({}), runNativeEditorSpecialties: native, packageCleanupAllowed: runner.packageCleanupAllowed,
    runNativeFileFirstModel: firstModel, fileFirstModelCleanupAllowed: fileRunner.fileFirstModelCleanupAllowed,
    installMac: install, installWindows: install, assertOwnedPath: vi.fn(), existsSync: () => true, join: posix.join, basename: posix.basename,
    command: vi.fn(() => { if (mode === 'later-failed') throw Error('旧安装回归失败'); }),
    detachMac: cleanup, uninstallWindows: cleanup, rmSync: cleanup, statSync: () => ({ dev: 1 }),
    console: { log: vi.fn(), error: vi.fn() }, AggregateError,
  };
  // 原控制块新增顶层await；仅包为async函数，仍执行实际try/catch/finally全部分支。
  await runInNewContext('(async () => {' + program + '})()', context);
  return { context, cleanup, install, native, firstModel };
}

describe('原安装脚本完整收尾与CI接线', () => {
  it.each([['node', '/RAM/native-editor-ci.mjs'], ['node', '/RAM/native-editor-ci.mjs', '--list']])('默认或list参数在批准/资源端口之前拒绝：%j', (...argv) => {
    const source = readFileSync(new URL('../../scripts/native-editor-ci.mjs', import.meta.url), 'utf8');
    const tree = ts.createSourceFile('runner.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const entry = tree.statements.find(ts.isIfStatement)!;
    // 只为VM提供模块URL常量；执行的仍是实际CLI入口全部控制块，所有资源端口均为RAM计数器。
    const code = entry.thenStatement.getText(tree).replaceAll('import.meta.url', '"file:///RAM/native-editor-ci.mjs"');
    const resource = vi.fn(() => { throw Error('不得进入资源端口'); });
    const context = { process: { argv, exitCode: 0 }, ciContext: resource, fileURLToPath: resource, console: { error: vi.fn() } };
    runInNewContext(code, context);
    expect(context.process.exitCode).toBe(1); expect(resource).not.toHaveBeenCalled();
  });
  it.each(['native-failed', 'later-failed', 'approval-failed'] as const)('%s保留现场，不卸载/分离/删除或重跑', async mode => {
    const f = await probe(mode); expect(f.context.testFailure).toBeDefined(); expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.native).toHaveBeenCalledTimes(mode === 'approval-failed' ? 0 : 1); expect(f.install).toHaveBeenCalledTimes(mode === 'approval-failed' ? 0 : 1);
    expect(f.context.console.error).toHaveBeenCalledWith(expect.stringContaining('现场保留'));
  });
  it('两项原退出证明及旧回归均成功才走原owned清理', async () => {
    const f = await probe('accepted'); expect(f.context.testFailure).toBeUndefined(); expect(f.native).toHaveBeenCalledTimes(1); expect(f.cleanup).toHaveBeenCalledTimes(2);
    expect(f.firstModel).toHaveBeenCalledOnce(); expect(f.native.mock.invocationCallOrder[0]).toBeLessThan(f.firstModel.mock.invocationCallOrder[0]); expect(f.firstModel.mock.invocationCallOrder[0]).toBeLessThan(f.context.command.mock.invocationCallOrder[0]);
  });
  it.each(['first-model-failed', 'first-model-unknown', 'first-model-footer-bad'] as const)('%s停止legacy并保留原安装根，不能借原两专项清理', async mode => {
    const f = await probe(mode); expect(f.native).toHaveBeenCalledOnce(); expect(f.firstModel).toHaveBeenCalledOnce(); expect(f.context.command).not.toHaveBeenCalled(); expect(f.context.testFailure).toBeDefined(); expect(f.cleanup).not.toHaveBeenCalled();
  });
  it('Mac原专项成功但显示恢复未知时，不启动legacy且保留安装根', async () => {
    const f = await probe('accepted', 'failed');
    expect(f.context.confirmMacInstalledCleanup).toHaveBeenCalledOnce(); expect(f.context.testFailure).toBeDefined(); expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.context.command).not.toHaveBeenCalled();
  });
  it('Mac先恢复显示再运行legacy；legacy失败仍保留安装根', async () => {
    const good = await probe('accepted', 'accepted');
    expect(good.context.testFailure).toBeUndefined(); expect(good.cleanup).toHaveBeenCalledTimes(2);
    expect(good.context.confirmMacInstalledCleanup.mock.invocationCallOrder[0]).toBeLessThan(good.cleanup.mock.invocationCallOrder[0]);
    expect(good.context.confirmMacInstalledCleanup.mock.invocationCallOrder[0]).toBeLessThan(good.context.command.mock.invocationCallOrder[0]);
    const bad = await probe('later-failed', 'accepted');
    expect(bad.context.confirmMacInstalledCleanup).toHaveBeenCalledOnce(); expect(bad.cleanup).not.toHaveBeenCalled();
  });
  it('CI三架构使用同次build直接打包，安装消费同job源批准，证据总上传且不自动取消', () => {
    const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('cancel-in-progress: false'); expect(workflow).toContain('if: always()');
    expect(workflow).toContain('run: node scripts/native-editor-ci.mjs source'); expect(workflow).not.toContain('run: pnpm test:e2e');
    expect(workflow).not.toContain('command: pnpm build'); expect(workflow).toContain('reference: release/win-unpacked/DBArk.exe'); expect(workflow).toContain('reference: release/mac-arm64/DBArk.app/Contents/MacOS/DBArk'); expect(workflow).toContain('reference: release/mac/DBArk.app/Contents/MacOS/DBArk');
    expect(workflow).toContain('DBARK_NATIVE_EDITOR_SOURCE_APPROVAL_SHA256: ${{ steps.native-source.outputs.source_approval_sha256 }}');
    expect(workflow.indexOf('run: node scripts/native-editor-ci.mjs source')).toBeLessThan(workflow.indexOf('run: ${{ matrix.command }}'));
    expect(workflow.indexOf('run: node scripts/native-editor-ci.mjs source')).toBeLessThan(workflow.indexOf('run: node scripts/native-file-first-model-ci.mjs source'));
    expect(workflow.indexOf('run: node scripts/native-file-first-model-ci.mjs source')).toBeLessThan(workflow.indexOf('run: pnpm exec playwright test'));
  });
});
