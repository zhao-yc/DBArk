import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/query-parameter-reuse.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

/** 默认和列举只可登记skip；读取认证或加载桌面/mysql/SQLite都会立即失败。 */
function load(argv: string[], enabled = false) {
  const skip = vi.fn(), imports: string[] = [], reads: string[] = [];
  const env = new Proxy({}, { get: (_target, key: string) => {
    reads.push(key);
    if (!['DBARK_INTEGRATION_ENABLED', 'DBARK_PARAMETER_REUSE_UI'].includes(key)) throw Error('默认门读取认证：' + key);
    return enabled ? '1' : undefined;
  } });
  runInNewContext(compiled, { exports: {}, process: { argv, env, platform: 'win32' }, require: (name: string) => {
    imports.push(name); if (name === '@playwright/test') return { test: { skip } }; throw Error('默认门加载了桌面依赖：' + name);
  } });
  return { skip, imports, reads };
}

describe('参数复用只读原生专项关闭门', () => {
  it('默认只登记一条跳过，不读取认证或加载Desktop/mysql/SQLite', () => {
    const f = load(['node', 'playwright']); expect(f.skip).toHaveBeenCalledOnce(); expect(f.imports).toEqual(['@playwright/test']); expect(f.reads).toEqual(['DBARK_INTEGRATION_ENABLED']);
  });
  it.each(['list', '--list', '--list=true'])('%s即使双门开启也不读认证或启动桌面', flag => {
    const f = load(['node', 'playwright', flag], true); expect(f.skip).toHaveBeenCalledOnce(); expect(f.reads).toEqual([]); expect(f.imports).toEqual(['@playwright/test']);
  });
  it('双门开启但目标未知时在加载Desktop前拒绝', () => {
    const skip = vi.fn(), imports: string[] = [];
    expect(() => runInNewContext(compiled, { exports: {}, process: { argv: ['node', 'playwright'], env: { DBARK_INTEGRATION_ENABLED: '1', DBARK_PARAMETER_REUSE_UI: '1' }, platform: 'win32' }, require: (name: string) => { imports.push(name); if (name === '@playwright/test') return { test: { skip } }; throw Error('过早加载Desktop'); } })).toThrow('专项目标');
    expect(imports).toEqual(['@playwright/test']); expect(skip).not.toHaveBeenCalled();
  });
});

/** 直接执行原spec中的恢复方法，复现删除Main状态后的本地收尾顺序。 */
function restorationFixture(options: { pending?: number; fail?: boolean } = {}) {
  const file = ts.createSourceFile('native.ts', source, ts.ScriptTarget.Latest, true);
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node): void { if (ts.isFunctionDeclaration(node) && node.name?.text === 'restoreAudit') declaration = node; ts.forEachChild(node, visit); }
  visit(file); if (!declaration) throw Error('缺少原生审计恢复方法');
  const code = ts.transpileModule(declaration.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const events: string[] = [], state = { armed: true, present: true };
  const context = {
    expect, get armed() { return state.armed; }, set armed(value: boolean) { state.armed = value; events.push('disarm'); },
    check() { events.push('check'); },
    async audit() { if (!state.present) throw Error('已删除审计状态'); events.push('audit'); return { forbidden: 0, pending: options.pending ?? 0 }; },
    application: { async evaluate(_callback: unknown) { events.push('restore'); if (options.fail) throw Error('恢复失败'); state.present = false; } }
  };
  return { events, state, run: runInNewContext(code + '\nrestoreAudit', context) as () => Promise<void> };
}

describe('参数复用原生审计恢复', () => {
  it('成功恢复后先撤标记再核owner，不再访问已删除的Main审计', async () => {
    const f = restorationFixture(); await f.run(); expect(f.events).toEqual(['check', 'audit', 'check', 'restore', 'disarm', 'check']); expect(f.state).toEqual({ armed: false, present: false });
  });
  it('恢复失败时保留本地标记和原审计，不能继续正常退出', async () => {
    const f = restorationFixture({ fail: true }); await expect(f.run()).rejects.toThrow('恢复失败'); expect(f.state).toEqual({ armed: true, present: true }); expect(f.events).not.toContain('disarm');
  });
  it('尚有请求时不恢复原handler或撤标记', async () => {
    const f = restorationFixture({ pending: 1 }); await expect(f.run()).rejects.toThrow(); expect(f.state).toEqual({ armed: true, present: true }); expect(f.events).not.toContain('restore');
  });
});
