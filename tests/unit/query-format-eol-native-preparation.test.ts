import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { assertFormatEolInitial, bindFormatEolEnvironment, formatEolActive, formatEolCases, formatEolExpected, formatEolSource, type FormatEolModel } from '../helpers/queryFormatEolNative';
import { planSqlFormatting } from '../../src/renderer/sqlFormatting';

/** 只构造RAM环境；清单从不读取，更不能把合成hash当作原生批准。 */
function environment() { return { DBARK_FORMAT_EOL_NATIVE_TEST: '1', DBARK_FORMAT_EOL_NATIVE_APPROVED: '1', DBARK_INTEGRATION_ENABLED: '0', DBARK_FORMAT_EOL_MANIFEST: 'C:\\future\\root-approved.json', DBARK_FORMAT_EOL_MANIFEST_SHA256: 'a'.repeat(64) } as NodeJS.ProcessEnv; }
const declaration = readFileSync(new URL('../e2e/query-format-eol-native.spec.ts', import.meta.url), 'utf8');
/** 仅解释实际声明门，live为RAM哨兵；不运行Playwright（含list）或任何原生入口。 */
function declare(env: NodeJS.ProcessEnv, argv: string[]) {
  const modules: string[] = [], skipped: string[] = [], register = vi.fn();
  runInNewContext(ts.transpileModule(declaration, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: {}, process: { env, argv, platform: 'win32' }, require(name: string) { modules.push(name); if (name === '@playwright/test') return { test: { skip: (name: string) => skipped.push(name) } }; if (name === '../helpers/queryFormatEolNative') return { formatEolActive, bindFormatEolEnvironment, formatEolCases }; if (name === './query-format-eol-native-live') return { registerFormatEolNative: register }; throw Error('未许可加载：' + name); }
  }); return { modules, skipped, register };
}
describe('首次格式化原生准备的声明和独立门', () => {
  it.each(['default', 'single', '--list', '--list=true'])('%s声明阶段仅两例，零live/清单/原生/端口', mode => {
    const env = mode === 'default' ? {} : environment(); if (mode === 'single') delete env.DBARK_FORMAT_EOL_NATIVE_APPROVED;
    const value = declare(env, mode.startsWith('--') ? [mode] : []); expect(value.skipped).toEqual([...formatEolCases]); expect(value.register).not.toHaveBeenCalled(); expect(value.modules).toEqual(['@playwright/test', '../helpers/queryFormatEolNative']);
  });
  it('list先于环境检查，门访问器从不执行', () => {
    const getter = vi.fn(() => { throw Error('禁止访问器'); }), env = Object.defineProperty({}, 'DBARK_FORMAT_EOL_NATIVE_TEST', { get: getter }); expect(formatEolActive(env, ['--list'])).toBe(false); expect(formatEolActive(env, [])).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it('双门只传Root未来清单参数，不能生成原生批准', () => { const value = declare(environment(), []); expect(value.register).toHaveBeenCalledOnce(); expect(value.register.mock.calls[0][0].approval).toEqual({ manifestPath: environment().DBARK_FORMAT_EOL_MANIFEST, approvedHash: 'a'.repeat(64) }); });
  it.each(['credential', 'other-gate', 'alias', 'preload', 'integration', 'manifest', 'trace', 'config', 'platform'])('%s在加载live之前拒绝', mode => {
    const env = environment(); let args: string[] = [], platform = 'win32'; if (mode === 'credential') env.DBARK_TEST_PASSWORD = ''; if (mode === 'other-gate') env.DBARK_EDITOR_INDENT_NATIVE_TEST = '0'; if (mode === 'alias') env.dbark_format_eol_native_test = '1'; if (mode === 'preload') env.NODE_OPTIONS = ''; if (mode === 'integration') env.DBARK_INTEGRATION_ENABLED = '1'; if (mode === 'manifest') delete env.DBARK_FORMAT_EOL_MANIFEST; if (mode === 'trace') args = ['--trace=on']; if (mode === 'config') args = ['--config=other.ts']; if (mode === 'platform') platform = 'linux';
    expect(() => bindFormatEolEnvironment(() => ({ env, args, platform }))).toThrow();
  });
  it('配置变化并恢复仍停链，不为新清单续签', () => { const env = environment(), binding = bindFormatEolEnvironment(() => ({ env, args: [], platform: 'win32' })); binding.assertCurrent(); env.DBARK_FORMAT_EOL_MANIFEST_SHA256 = 'b'.repeat(64); expect(() => binding.assertCurrent()).toThrow(); env.DBARK_FORMAT_EOL_MANIFEST_SHA256 = 'a'.repeat(64); expect(() => binding.assertCurrent()).toThrow(); });
});
function model(eol: string): FormatEolModel { return { id: 1, value: formatEolSource.replaceAll('\n', eol), eol, version: 2, changes: 0, focused: true, selections: [{ start: 0, end: 0 }] }; }
describe('首次编辑前的LF/实际EOL证明', () => {
  it('Windows真实CRLF模型与原LF查询/草稿才构成回归差异，不先追平store', () => { expect(assertFormatEolInitial(formatEolSource, formatEolSource, model('\r\n'), 'win32')).toMatchObject({ draftLf: true, modelEol: '\r\n', mismatched: true, userEditsBeforeFormat: 0 }); });
  it.each(['\n', '\r\n'])('macOS按实际%j判断；LF/LF明确不冒称差异覆盖', eol => { expect(assertFormatEolInitial(formatEolSource, formatEolSource, model(eol), 'darwin').mismatched).toBe(eol === '\r\n'); });
  it.each(['store-aligned', 'query-edited', 'model-edited', 'prior-content-event', 'windows-lf', 'unknown-eol'])('%s必须拒绝首次场景，而不是先补空格/撤销修复前提', mode => {
    const actual = model('\r\n'); let source = formatEolSource, draft = formatEolSource; if (mode === 'store-aligned') draft = actual.value; if (mode === 'query-edited') source += ' '; if (mode === 'model-edited') actual.value += ' '; if (mode === 'prior-content-event') actual.changes = 1; if (mode === 'windows-lf') Object.assign(actual, model('\n')); if (mode === 'unknown-eol') actual.eol = '\r'; expect(() => assertFormatEolInitial(source, draft, actual, 'win32')).toThrow();
  });
  it.each(['\n', '\r\n'])('独立手写黄金值与正式formatter在模型%j上一致，不由输出制造答案', eol => { const source = formatEolSource.replaceAll('\n', eol); expect(planSqlFormatting(source, 0, source.length, eol)?.text).toBe(formatEolExpected.replaceAll('\n', eol)); });
  it('真实live两入口独立case、首次触发前无正文按键，单次Undo及原两owner收尾完整', () => {
    const live = readFileSync(new URL('../e2e/query-format-eol-native-live.ts', import.meta.url), 'utf8'), firstTrigger = live.indexOf('if (entry === 0)'); expect(firstTrigger).toBeGreaterThan(0);
    expect(live.slice(0, firstTrigger)).not.toMatch(/keyboard\.insertText|press\(['"]Space|\+z['"]\)/); expect(live).not.toMatch(/\.setValue\(|\.setEOL\(|\.setModel\(|\.executeEdits\(|clipboard|useWorkspace|desktop-fixture|native-startup|native-editor-progress/);
    for (const value of ['bindEditorIndentNativeCase(info, binding, () => test.info())', 'timeout: 120000', 'createEditorIndentNativeRun(scope, binding.approval)', 'readIndentNativeSettings', 'toBe(9)', 'await run.close(first)', 'await run.close(second)', 'await run.finish()', 'run.retained = true', 'assertFormatEolInitial(untouched.effects.queries[0].sql', "keyboard.press('Alt+Shift+f')", 'name: sqlFormattingZh.action', "keyboard.press(modifier + '+z')", 'expect(changed.changes).toBe(1)']) expect(live).toContain(value);
    expect(live.indexOf('await run.close(first)')).toBeLessThan(live.indexOf('const second = await run.launch()')); expect(live.indexOf('await run.close(second)')).toBeLessThan(live.indexOf('await run.finish()'));
  });
});
