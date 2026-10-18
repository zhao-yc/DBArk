import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const specSource = readFileSync(new URL('../e2e/editor-indentation-native.spec.ts', import.meta.url), 'utf8');
/** 只提取实际函数声明，不导入会注册正式用例、读取环境或启动原生模块的spec。 */
function declaration(source: string, name: string): string {
  const tree = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(value => (ts.isFunctionDeclaration(value) || ts.isClassDeclaration(value)) && value.name?.text === name);
  if (!node) throw Error('找不到固定源码声明：' + name);
  return node.getText(tree);
}
const compiledSeed = ts.transpileModule(['write', 'seedOriginalTab'].map(name => declaration(specSource, name)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const expected = ["SELECT '900719925474099312345', '🚢';", '\t-- 原始Tab不能自动转换', ...Array.from({ length: 65 }, (_, index) => '-- 缩进滚动探针 ' + index)].join('\n');

/** 键盘/只读观察均为RAM端口；实际执行spec种子函数，不创建窗口、端口、目录或系统剪贴板。 */
function fixture(fault?: '继承空格' | '精度损失' | 'Tab转空格' | '光标偏移' | '原门失效') {
  let active = true, text = '', cursor = 0, selectedAll = false;
  const inputs: string[] = [], keys: string[] = [];
  const guard = () => { if (!active) throw Error('RAM原门已失效'); };
  const input = { focus: async () => { guard(); } };
  const page = { locator: (selector: string) => { expect(selector).toBe('.query-tab:visible .monaco-editor'); return { getByRole: (role: string) => { expect(role).toBe('textbox'); return input; } }; }, keyboard: {
    press: async (key: string) => {
      guard(); keys.push(key);
      if (key === 'Control+A') selectedAll = true;
      else if (key === 'Control+Home') { cursor = 0; selectedAll = false; }
      else if (key === 'ArrowDown') { cursor = text.indexOf('\n') + 1 + (fault === '光标偏移' ? 1 : 0); if (fault === '原门失效') active = false; }
      else throw Error('种子出现未约定键盘操作：' + key);
    },
    insertText: async (value: string) => {
      guard(); inputs.push(value); const inserted = value === '\t' && fault === 'Tab转空格' ? '  ' : value;
      if (selectedAll) { text = inserted; cursor = inserted.length; selectedAll = false; } else { text = text.slice(0, cursor) + inserted + text.slice(cursor); cursor += inserted.length; }
      if (value.includes('\n') && fault === '继承空格') text = text.replaceAll('-- 缩进滚动探针', '  -- 缩进滚动探针');
      if (fault === '精度损失') text = text.replace('900719925474099312345', '900719925474099300000');
    },
  } };
  const owner = { page }, run = { step: async <T>(target: unknown, action: () => Promise<T>): Promise<T> => { guard(); expect(target).toBe(owner); const value = await action(); guard(); return value; } };
  const current = async () => { guard(); const lines = text.slice(0, cursor).split('\n'), line = lines.length, column = lines.at(-1)!.length + 1; return { value: text, selections: [{ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column, positionLineNumber: line, positionColumn: column }] }; };
  const settings = async () => { guard(); return { activeTabId: 'seed', tabs: [{ id: 'seed', sql: text }] }; };
  const nativeExpect = Object.assign((value: unknown) => expect(value), { poll: (read: () => Promise<unknown>) => ({ toBe: async (value: unknown) => expect(await read()).toBe(value) }) });
  const seed = runInNewContext(compiledSeed + '\nseedOriginalTab', { expect: nativeExpect, current, settings, modifier: 'Control', top: 'Control+Home' }) as (run: unknown, owner: unknown) => Promise<void>;
  return { execute: () => seed(run, owner), text: () => text, inputs, keys };
}

describe('run1627固定种子与精确oracle（RAM）', () => {
  it('先零缩进多行、再定位第2行插入字面Tab，精度/emoji/65行均精确固定', async () => {
    const f = fixture(); await f.execute(); expect(f.text()).toBe(expected);
    expect(f.inputs).toEqual([expected.replace('\n\t', '\n'), '\t']); expect(f.keys).toEqual(['Control+A', 'Control+Home', 'ArrowDown']);
    expect(f.inputs[0].split('\n').every(line => !/^[ \t]/u.test(line))).toBe(true); expect(f.text().split('\n').slice(2)).toEqual(Array.from({ length: 65 }, (_, index) => '-- 缩进滚动探针 ' + index));
  });
  it.each(['继承空格', '精度损失'] as const)('输入端出现%s必须在补Tab之前拒绝，不能trim或从UI反推期望', async fault => {
    const f = fixture(fault); await expect(f.execute()).rejects.toThrow(); expect(f.inputs).toHaveLength(1); expect(f.inputs[0]).toContain("900719925474099312345', '🚢'");
  });
  it('字面Tab被转为空格时精确拒绝，不能把输入合法化为新的持久化基线', async () => {
    const f = fixture('Tab转空格'); await expect(f.execute()).rejects.toThrow(); expect(f.inputs.at(-1)).toBe('\t'); expect(f.text()).not.toBe(expected);
  });
  it('光标不在第2行第1列时不允许补Tab', async () => {
    const f = fixture('光标偏移'); await expect(f.execute()).rejects.toThrow(); expect(f.inputs).toHaveLength(1);
  });
  it('键盘步骤期间原门失效后不继续输入Tab', async () => {
    const f = fixture('原门失效'); await expect(f.execute()).rejects.toThrow('原门已失效'); expect(f.inputs).toHaveLength(1);
  });
  it('执行锁定Monaco实际换行保留分支：Tab会规范成两空格，无前导缩进则保持空', () => {
    const require = createRequire(import.meta.url), root = dirname(require.resolve('monaco-editor/package.json'));
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.55.1');
    const vendor = (relative: string) => readFileSync(join(root, 'esm/vs', relative), 'utf8');
    const strings = vendor('base/common/strings.js'), indentation = vendor('editor/common/core/misc/indentation.js'), operations = vendor('editor/common/cursor/cursorTypeEditOperations.js');
    const declarations = [declaration(strings, 'firstNonWhitespaceIndex'), declaration(strings, 'getLeadingWhitespace'), declaration(vendor('editor/common/core/cursorColumns.js'), 'CursorColumns'), declaration(indentation, '_normalizeIndentationFromWhitespace'), declaration(indentation, 'normalizeIndentation'), declaration(operations, 'EnterOperation'), declaration(operations, 'typeCommand')].join('\n');
    const runtime = runInNewContext(ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + '\n({EnterOperation,normalizeIndentation})', { ReplaceCommand: class { constructor(readonly range: unknown, readonly text: string) {} } }) as { EnterOperation: { _enter(config: unknown, model: unknown, keep: boolean, range: unknown): { text: string } }; normalizeIndentation(value: string, width: number, spaces: boolean): string };
    const config = { autoIndent: 4, normalizeIndentation: (value: string) => runtime.normalizeIndentation(value, 2, true) };
    // 仅给实际_enter提供廉价分词不可用的RAM端口；不声称已执行真实SQL分词或GUI输入链。
    const enter = (line: string) => runtime.EnterOperation._enter(config, { tokenization: { isCheapToTokenize: () => false }, getLineContent: () => line }, false, { startLineNumber: 1, startColumn: line.length + 1, getStartPosition: () => ({ lineNumber: 1, column: line.length + 1 }) }).text;
    expect(enter('\t-- 原始Tab不能自动转换')).toBe('\n  '); expect(enter('  -- 缩进滚动探针 0')).toBe('\n  '); expect(enter('-- 缩进滚动探针 0')).toBe('\n');
  });
});
