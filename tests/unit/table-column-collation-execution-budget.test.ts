import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { types } from 'node:util';
import ts from 'typescript';
import { expect, it } from 'vitest';

/** 提取生产私有复制器，边界直接测原函数，不新增导出或维护手写计量副本。 */
function productionCopy(): <T>(value: T) => T {
  const source = readFileSync(new URL('../../src/engine/tableColumnCollationExecution.ts', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('execution.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declaration = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'copyEvidence');
  if (!declaration) throw Error('没有提取到真实证据复制器');
  const compiled = ts.transpileModule(declaration.getText(tree) + '\nglobalThis.actualCopy=copyEvidence;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { Buffer, types, Map, Object, Reflect, WeakMap, WeakSet, Number, String, Array, Error, actualCopy: undefined as unknown };
  runInNewContext(compiled, context);
  return context.actualCopy as <T>(value: T) => T;
}
const copy = productionCopy(), limit = 32 * 1024 * 1024;
/** 按UTF-8字节数生成含中文的精确负载，防止把UTF-16长度误当预算。 */
function text(bytes: number): string { return '中'.repeat(Math.floor(bytes / 3)) + 'x'.repeat(bytes % 3); }

it.each(['对象键', 'Map键', '字符串值'] as const)('%s恰好32MiB通过，多1字节拒绝', kind => {
  // 对象：容器2+键引号/冒号/分隔4+数值1；Map另含条目结构4与字符串引号2。
  const overhead = kind === '对象键' ? 7 : kind === 'Map键' ? 9 : 2;
  const payload = (bytes: number) => kind === '对象键' ? { [text(bytes)]: 1 } : kind === 'Map键' ? new Map([[text(bytes), 1]]) : text(bytes);
  expect(() => copy(payload(limit - overhead))).not.toThrow();
  expect(() => copy(payload(limit - overhead + 1))).toThrow('32 MiB');
});

it('普通对象键、Map键和值共用同一预算，不能各占32MiB', () => {
  const half = limit / 2;
  expect(() => copy({ [text(half)]: text(half) })).toThrow('32 MiB');
  expect(() => copy(new Map([[text(half), text(half)]]))).toThrow('32 MiB');
});

it('ASCII超32MiB旁键被拒绝，不针对字段名称或中文样本', () => {
  expect(() => copy({ ['k'.repeat(limit + 1)]: 1 })).toThrow('32 MiB');
});

it('普通值、Map和重复对象保持独立复制，循环和访问器仍不执行', () => {
  const nested = { flag: true, count: 42, absent: undefined, empty: null }, input = { nested, alias: nested, values: new Map([['中文键', nested]]) };
  const output = copy(input);
  expect(output.nested).not.toBe(nested); expect(output.alias).toBe(output.nested);
  expect(output.values).not.toBe(input.values); expect(output.values.get('中文键')).toBe(output.nested);
  let reads = 0;
  expect(() => copy(Object.defineProperty({}, '旁键', { enumerable: true, get() { reads++; return 1; } }))).toThrow();
  expect(reads).toBe(0);
  const cyclic: any = {}; cyclic.self = cyclic; expect(() => copy(cyclic)).toThrow('循环');
});

it('节点和深度门保持300000及48，不能靠低字节内容绕过', () => {
  expect(() => copy(Array(299999).fill(null))).not.toThrow();
  expect(() => copy(Array(300000).fill(null))).toThrow('节点或深度');
  let nested: unknown = null;
  for (let index = 0; index < 48; index++) nested = { child: nested };
  expect(() => copy(nested)).not.toThrow();
  nested = { child: nested };
  expect(() => copy(nested)).toThrow('节点或深度');
});
