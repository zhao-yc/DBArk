import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '../../src/renderer/components/ui';
import { zh } from '../../src/renderer/locales/zh-CN';

const designerSource = readFileSync(new URL('../../src/renderer/components/SchemaDialog.tsx', import.meta.url), 'utf8');
const liveSource = readFileSync(new URL('../e2e/table-create-foreign-keys-live.ts', import.meta.url), 'utf8');
const tree = ts.createSourceFile('SchemaDialog.tsx', designerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
/** 提取真实设计器Field原件；不另造标签、选项或事件绑定。 */
function actualField(key: 'text042' | 'text043') {
  let fragment = '';
  function visit(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'Field' && node.openingElement.attributes.getText(tree) === 'label={zh.schema.' + key + '}') fragment = node.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); expect(fragment).not.toBe('');
  const foreignAt = vi.fn(), context = createContext({ exports: {}, require: (name: string) => { expect(name).toBe('react/jsx-runtime'); return jsx; }, Field, zh, foreign: { onUpdate: 'RESTRICT', onDelete: 'RESTRICT' }, index: 7, foreignAt });
  const compiled = ts.transpileModule('globalThis.element=(' + fragment + ');', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInContext(compiled, context);
  const element = context.element as ReactElement<{ label: string; children: ReactElement<{ onChange(event: { target: { value: string } }): void }> }>;
  return { element, foreignAt, markup: renderToStaticMarkup(element) };
}

describe('FK正式选择器对应真实SchemaDialog标签和原生控件（纯RAM）', () => {
  for (const [key, property] of [['text042', 'onUpdate'], ['text043', 'onDelete']] as const) {
    it(zh.schema[key] + '按准确标签找到原生select并写入' + property, async () => {
      const actual = actualField(key);
      expect(actual.markup).toContain('<label class="field "><span>' + zh.schema[key] + '</span><select>');
      // 原label全文包含原生option文本，精确匹配单独“更新时/删除时”无法命中。
      const labelText = actual.markup.replace(/<[^>]+>/g, '');
      expect(labelText).not.toBe(zh.schema[key]); expect(labelText).toContain('CASCADE');
      const liveTree = ts.createSourceFile('live.ts', liveSource, ts.ScriptTarget.Latest, true); let selection = '';
      function visit(node: ts.Node) { if (ts.isCallExpression(node) && node.expression.getText(liveTree).endsWith('.selectOption') && node.getText(liveTree).includes('zh.schema.' + key)) selection = node.getText(liveTree); ts.forEachChild(node, visit); }
      visit(liveTree); expect(selection).not.toBe('');
      const selected = vi.fn(async (value: string) => { actual.element.props.children.props.onChange({ target: { value } }); });
      const context = createContext({ zh, page: { getByText: (value: string, options: unknown) => { expect(value).toBe(actual.element.props.label); expect(options).toEqual({ exact: true }); return { value }; } }, foreign: {
        getByLabel: (value: string, options: { exact: boolean }) => ({ selectOption: async () => { expect(options.exact).toBe(true); expect(labelText).toBe(value); } }),
        locator: (selector: string) => { expect(selector).toBe('label.field'); return { filter: ({ has }: { has: { value: string } }) => { expect(has.value).toBe(actual.element.props.label); return { getByRole: (role: string) => { expect(role).toBe('combobox'); expect(actual.element.props.children.type).toBe('select'); return { selectOption: selected }; } }; } }; },
      } });
      await runInContext('(async()=>await ' + selection + ')()', context);
      expect(selected).toHaveBeenCalledExactlyOnceWith('CASCADE');expect(actual.foreignAt).toHaveBeenCalledExactlyOnceWith(7, { [property]: 'CASCADE' });
    });
  }
});
