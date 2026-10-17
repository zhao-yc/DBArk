import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
const compiled = ts.transpileModule(readFileSync(new URL('../e2e/csv-export-fields.spec.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 真实转译入口只提供RAM注册端口，环境读取代理禁止越过两道开关。 */
function collect(argv: string[], integration: string, fields: string) {
  const reads: string[] = [], loads: string[] = [], skip = vi.fn(), register = vi.fn();
  const env = new Proxy({ DBARK_INTEGRATION_ENABLED: integration, DBARK_CSV_EXPORT_FIELDS_UI: fields }, { get(values, key: string) { reads.push(key); if (!Object.hasOwn(values, key)) throw Error('收集不得读取额外配置'); return values[key as keyof typeof values]; } });
  runInContext(compiled, createContext({ exports: {}, process: { argv, env }, require(name: string) {
    if (name === '@playwright/test') return { test: { skip } }; loads.push(name); if (argv.some(value => value === '--list' || value.startsWith('--list='))) throw Error('收集不得加载实跑模块'); if (name === './csv-export-fields-live') return { registerCsvExportFieldsUiTests: register }; throw Error('禁止实际导入');
  } })); return { reads, loads, skip, register };
}
describe('CSV字段正式UI双门与列表隔离', () => {
  for (const integration of ['0', '1']) for (const fields of ['0', '1']) {
    for (const flag of ['--list', '--list=json']) it(`${flag} 两门${integration}/${fields}先短路且零配置读取`, () => { const value = collect([flag], integration, fields); expect(value.reads).toEqual([]); expect(value.loads).toEqual([]); expect(value.register).not.toHaveBeenCalled(); expect(value.skip).toHaveBeenCalledOnce(); });
    it(`非列表两门${integration}/${fields}只有双开注册RAM端口`, () => { const value = collect([], integration, fields), active = integration === '1' && fields === '1'; expect(value.loads).toEqual(active ? ['./csv-export-fields-live'] : []); expect(value.register).toHaveBeenCalledTimes(active ? 1 : 0); });
  }
  it.each(['running', 'unknown', 'read-failed', 'completed'])('严格owner下CSV状态%s只有已终态才允许交给原退出链', async status => {
    const source = readFileSync(new URL('../e2e/csv-export-fields-live.ts', import.meta.url), 'utf8'), tree = ts.createSourceFile('live.ts', source, ts.ScriptTarget.ES2022, true), method = tree.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'assertCsvExportTasksTerminal')!;
    const code = ts.transpileModule(method.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const retained = vi.fn(), owner = { closed: false, page: { evaluate: async () => { if (status === 'read-failed') throw Error('读取未知'); return [{ kind: 'files.export', status }]; } } }, exports: { assertCsvExportTasksTerminal?: (info: unknown) => Promise<void> } = {};
    runInContext(code, createContext({ exports, ownedDesktopResources: () => owner, retainOwnedDesktopResources: retained }));
    const result = exports.assertCsvExportTasksTerminal!({}); if (status === 'completed') { await result; expect(retained).not.toHaveBeenCalled(); } else { await expect(result).rejects.toThrow(); expect(retained).toHaveBeenCalledOnce(); }
  });
});
