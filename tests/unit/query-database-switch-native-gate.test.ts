import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../e2e/query-database-switch.spec.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

/** 默认/列举只允许读取双门；任何认证读取或桌面/mysql/SQLite加载立即失败。 */
function load(argv: string[], enabled: Partial<Record<'DBARK_INTEGRATION_ENABLED' | 'DBARK_DATABASE_SWITCH_UI', string>> = {}) {
  const skip = vi.fn(), imports: string[] = [], reads: string[] = [];
  const env = new Proxy({}, { get: (_target, key: string) => {
    reads.push(key);
    if (!['DBARK_INTEGRATION_ENABLED', 'DBARK_DATABASE_SWITCH_UI'].includes(key)) throw Error('切库默认门读取认证：' + key);
    return enabled[key as keyof typeof enabled];
  } });
  runInNewContext(compiled, { exports: {}, process: { argv, env, platform: 'win32' }, require: (name: string) => {
    imports.push(name); if (name === '@playwright/test') return { test: { skip } }; throw Error('切库默认门加载了桌面依赖：' + name);
  } });
  return { skip, imports, reads };
}

describe('切库新资源专项默认关闭门', () => {
  it('默认只登记跳过，不读认证或加载Desktop/mysql/SQLite', () => {
    const f = load(['node', 'playwright']); expect(f.skip).toHaveBeenCalledOnce(); expect(f.imports).toEqual(['@playwright/test']); expect(f.reads).toEqual(['DBARK_INTEGRATION_ENABLED']);
  });
  it.each(['list', '--list', '--list=true'])('%s即使双门开启也不读认证或启动桌面', flag => {
    const f = load(['node', 'playwright', flag], { DBARK_INTEGRATION_ENABLED: '1', DBARK_DATABASE_SWITCH_UI: '1' });
    expect(f.skip).toHaveBeenCalledOnce(); expect(f.reads).toEqual([]); expect(f.imports).toEqual(['@playwright/test']);
  });
  it('任一门未开都不能复用其它实库专项的授权', () => {
    for (const enabled of [{ DBARK_INTEGRATION_ENABLED: '1' }, { DBARK_DATABASE_SWITCH_UI: '1' }]) {
      const f = load(['node', 'playwright'], enabled); expect(f.skip).toHaveBeenCalledOnce(); expect(f.imports).toEqual(['@playwright/test']);
    }
  });
  it('双门开启而准确目标未绑定时，在加载桌面/驱动之前拒绝', () => {
    const imports: string[] = [], skip = vi.fn();
    expect(() => runInNewContext(compiled, { exports: {}, process: { argv: ['node', 'playwright'], platform: 'win32', env: { DBARK_INTEGRATION_ENABLED: '1', DBARK_DATABASE_SWITCH_UI: '1' } }, require: (name: string) => { imports.push(name); if (name === '@playwright/test') return { test: { skip } }; throw Error('切库过早加载桌面'); } })).toThrow('专项目标');
    expect(imports).toEqual(['@playwright/test']); expect(skip).not.toHaveBeenCalled();
  });
});

/** 直接执行原spec恢复方法，确保删除Main状态后不再通过step访问审计。 */
function restorationFixture(options: { pending?: number; fail?: boolean } = {}) {
  const file = ts.createSourceFile('native.ts', source, ts.ScriptTarget.Latest, true);
  let declaration: ts.FunctionDeclaration | undefined;
  function visit(node: ts.Node): void { if (ts.isFunctionDeclaration(node) && node.name?.text === 'restoreAudit') declaration = node; ts.forEachChild(node, visit); }
  visit(file); if (!declaration) throw Error('切库专项缺少原审计恢复方法');
  const code = ts.transpileModule(declaration.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const events: string[] = [], state = { armed: true, present: true };
  const context = {
    expect, get armed() { return state.armed; }, set armed(value: boolean) { state.armed = value; events.push('disarm'); },
    check() { events.push('check'); },
    async audit() { if (!state.present) throw Error('切库审计已删除'); events.push('audit'); return { forbidden: 0, pending: options.pending ?? 0 }; },
    application: { async evaluate(_callback: unknown) { events.push('restore'); if (options.fail) throw Error('恢复失败'); state.present = false; } },
  };
  return { events, state, run: runInNewContext(code + '\nrestoreAudit', context) as () => Promise<void> };
}

describe('切库原Main审计恢复顺序', () => {
  it('恢复成功先撤标记再核owner，不访问已删除状态', async () => {
    const f = restorationFixture(); await f.run(); expect(f.events).toEqual(['check', 'audit', 'check', 'restore', 'disarm', 'check']); expect(f.state).toEqual({ armed: false, present: false });
  });
  it('恢复失败或原请求未终态就保留原审计，不继续正常退出', async () => {
    const failed = restorationFixture({ fail: true }); await expect(failed.run()).rejects.toThrow('恢复失败'); expect(failed.state).toEqual({ armed: true, present: true });
    const pending = restorationFixture({ pending: 1 }); await expect(pending.run()).rejects.toThrow(); expect(pending.state).toEqual({ armed: true, present: true }); expect(pending.events).not.toContain('restore');
  });
});
