import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const ci: any = await import(new URL('../../scripts/native-editor-ci.mjs', import.meta.url).href);
const source = readFileSync(new URL('../../scripts/native-editor-ci.mjs', import.meta.url), 'utf8');
const tree = ts.createSourceFile('native-editor-ci.mjs', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functions = ['runNativeEditorSpecialties', 'success'].map(name => tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)!);
if (functions.some(value => !value)) throw Error('原CI顺序入口缺失');
const program = ts.transpileModule(functions.map(node => node.getText(tree)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
/** 文件/清单验证/日志/子进程全部为RAM；执行原顺序函数，只验证本轮进度目标接线。 */
function fixture(original?: Error, diagnostic?: Error) {
  const output = resolve('RAM-progress-ci'), context = { commit: 'a'.repeat(40) };
  const approval = { path: join(output, 'source-approval.json'), sha256: 'b'.repeat(64), value: { phase: 'source', project: join(output, 'project'), context, manifests: Object.fromEntries(['indent', 'layout'].map(name => [name, { path: join(output, 'source-' + name + '-manifest.json'), sha256: 'c'.repeat(64) }])) } };
  const events: string[] = [], records: any[] = [], environments: any[] = [];
  const prepare = vi.fn((options: any) => { events.push('prepare'); records.push(options); return { sha256: 'd'.repeat(64) }; });
  const execute = vi.fn((_exe: string, _args: string[], options: any) => { events.push('execute'); environments.push(options.env); return original ? { status: 1, error: original } : { status: 0 }; });
  const globals: any = {
    exports: {}, resolve, dirname, join, nativeSpecialties: ci.nativeSpecialties, process: { execPath: 'RAM-node' },
    readApproval: () => approval, mkdirSync: vi.fn(), writeOnce: (path: string) => { if (path.endsWith('failure.json') && diagnostic) throw diagnostic; },
    readFileSync: () => '{}', assertSpecialtyResult: () => ({ accepted: true }), saveCommand: vi.fn(),
    specialtyEnvironment: ci.specialtyEnvironment, prepareNativeProgress: prepare, AggregateError,
  };
  const run = runInNewContext(program + '\nrunNativeEditorSpecialties', globals);
  return { execute, prepare, environments, events, records, call: (diagnostics = true) => run({ approval, output, diagnostics, parentEnv: { DBARK_NATIVE_EDITOR_PROGRESS_SHA256: '不可继承的旧值', DBARK_NATIVE_EDITOR_PROGRESS_FILE: '任意环境路径' } }, execute) };
}
describe('每个独立PW进程的固定进度文件接线（RAM）', () => {
  it('直接/RAM调用默认关闭，不创建进度文件或继承旧诊断环境', () => {
    const f = fixture(); f.call(false); expect(f.prepare).not.toHaveBeenCalled(); for (const env of f.environments) { expect(env.DBARK_NATIVE_EDITOR_PROGRESS).toBeUndefined(); expect(env.DBARK_NATIVE_EDITOR_PROGRESS_SHA256).toBeUndefined(); }
  });
  it('每次先按本项批准创建固定文件，再启动一次进程，仅传开启门和摘要而非路径', () => {
    const f = fixture(); f.call(); expect(f.events).toEqual(['prepare', 'execute', 'prepare', 'execute']);
    expect(f.records.map(value => value.manifestPath)).toEqual([join(resolve('RAM-progress-ci'), 'source-indent-manifest.json'), join(resolve('RAM-progress-ci'), 'source-layout-manifest.json')]);
    for (const env of f.environments) { expect(env.DBARK_NATIVE_EDITOR_PROGRESS).toBe('1'); expect(env.DBARK_NATIVE_EDITOR_PROGRESS_SHA256).toBe('d'.repeat(64)); expect(env.DBARK_NATIVE_EDITOR_PROGRESS_FILE).toBeUndefined(); }
  });
  it('原进程失败与诊断写失败同时存在时保留原cause且不启动第二项', () => {
    const original = Error('原进程失败'), diagnostic = Error('failure.json写失败'), f = fixture(original, diagnostic);
    let caught: any; try { f.call(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AggregateError); expect(caught.cause).toBe(original); expect(caught.errors).toEqual([original, diagnostic]); expect(f.execute).toHaveBeenCalledTimes(1); expect(f.prepare).toHaveBeenCalledTimes(1);
  });
});
