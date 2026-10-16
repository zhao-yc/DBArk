import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DataTypeColor } from '../../src/renderer/components/DataTypeColor';
import { catalogColorType } from '../../src/renderer/dataTypeColors';
import { cellPreview, ownCell } from '../../src/renderer/lib';
import { encodeClipboard } from '../../src/renderer/gridClipboard';
import { zh } from '../../src/renderer/locales/zh-CN';
import type { CellValue } from '../../src/shared/contracts';

/** 抽取两种正式网格的真实renderCell回调，仅替换外部状态，最终渲染真实共用组件。 */
function renderer(kind: 'table' | 'result', value: CellValue | undefined, type: string | undefined, options: { enabled?: boolean; cellSelected?: boolean; rowSelected?: boolean; duplicate?: boolean; forbidLookup?: boolean } = {}) {
  const file = kind === 'table' ? 'TableTab' : 'ResultsGrid', source = readFileSync(new URL(`../../src/renderer/components/${file}.tsx`, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file + '.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let render = '';
  function visit(node: ts.Node) { if (ts.isPropertyAssignment(node) && node.name.getText(tree) === 'renderCell') { if (render) throw Error('生产renderCell不唯一'); render = node.initializer.getText(tree); } ts.forEachChild(node, visit); } visit(tree); if (!render) throw Error('缺少生产renderCell');
  const row = kind === 'table' ? Object.freeze({ id: 'row', data: Object.freeze({ c0: value }) }) : Object.freeze({ c0: value });
  const selectedRows = new Set(options.rowSelected ? [kind === 'table' ? 'row' : 0] : []);
  const port = createContext({ React, DataTypeColor, catalogColorType: options.forbidLookup ? () => { throw Error('关闭时不应新增目录访问'); } : catalogColorType, ownCell, cellPreview, zh, column: { key: 'c0', name: '同名列', type }, info: { columns: [{ name: 'c0', type }, ...(options.duplicate ? [{ name: 'c0', type: 'VARCHAR(10)' }] : [])] }, settings: { dataTypeColors: options.enabled }, dataTypeColors: options.enabled === true, selectedRows, rowIndexes: new Map([[row, 0]]) });
  runInContext(ts.transpileModule('globalThis.render=(' + render + ');', { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, port);
  const before = JSON.stringify(row), node = port.render({ row, tabIndex: options.cellSelected ? 0 : -1 });
  const html = renderToStaticMarkup(node); expect(JSON.stringify(row)).toBe(before); return html;
}

describe('D08正式网格调用方一致性', () => {
  it('默认关闭不增加目录类型访问，原渲染不依赖颜色元数据', () => { expect(() => renderer('table', '原文', undefined, { forbidLookup: true })).not.toThrow(); });
  it.each([
    ['varchar(20)', 'VAR_STRING', '123', 'text'], ['BIGINT UNSIGNED', 'LONGLONG', '9007199254740993', 'number'], ['decimal(20,10)', 'NEWDECIMAL', '0.1234567890', 'number'],
    ['datetime(6)', 'DATETIME', '2026-10-16 12:34:56.123456', 'temporal'], ['JSON', 'JSON', '{"n":"123"}', 'json'], ['VARBINARY(20)', 'BLOB', { type: 'binary', base64: 'AAE=' }, 'binary'], ['varchar(20)', 'VAR_STRING', null, 'null'],
  ] as const)('目录%s和协议%s对可靠语义采用相同类别，原展示文本不变', (catalog, protocol, value, expected) => {
    const values = value as CellValue;
    for (const [kind, type] of [['table', catalog], ['result', protocol]] as const) {
      const off = renderer(kind, values, type), on = renderer(kind, values, type, { enabled: true });
      expect(off).not.toContain('data-value-type'); expect(on).toContain(`data-value-type="${expected}"`);
      const text = (html: string) => html.replace(/<[^>]*>/g, ''); expect(text(on)).toBe(text(off));
    }
  });
  it.each(['table', 'result'] as const)('%s活动单元格与勾选行均保持原样，不覆盖NULL标记或选择样式', kind => {
    for (const value of ['123', null] as const) for (const selected of [{ cellSelected: true }, { rowSelected: true }]) {
      const html = renderer(kind, value, kind === 'table' ? 'INT' : 'LONG', { enabled: true, ...selected }); expect(html).not.toContain('data-value-type'); if (value === null) expect(html).toContain('null-value');
    }
  });
  it('缺失/重复目录和有歧义协议保留默认，正式二进制包装仍可识别', () => {
    expect(renderer('table', '123', undefined, { enabled: true })).not.toContain('data-value-type'); expect(renderer('table', '123', 'INT', { enabled: true, duplicate: true })).not.toContain('data-value-type'); expect(renderer('result', '{"n":1}', 'BLOB', { enabled: true })).not.toContain('data-value-type');
    expect(renderer('result', { type: 'binary', base64: 'AA==' }, 'BLOB', { enabled: true })).toContain('data-value-type="binary"');
  });
  it('表格DEFAULT与只读结果空缺的既有区别保留，颜色不把DEFAULT改成NULL', () => {
    const table = renderer('table', undefined, 'JSON', { enabled: true }), result = renderer('result', undefined, 'JSON', { enabled: true });
    expect(table).toContain('default-value'); expect(table).toContain(zh.common.defaultValue); expect(result).not.toContain('default-value'); expect(table + result).not.toContain('data-value-type');
  });
  it('着色前后原精确值、NULL和字节仍编码为相同复制协议，不读取系统剪贴板', () => {
    const values: CellValue[] = ['9007199254740993', '0.100000000000001', '2026-10-16', null, { type: 'binary', base64: 'AP8=' }]; const encoded = encodeClipboard([values]);
    values.forEach(value => { renderer('table', value, 'VARCHAR(100)', { enabled: true }); renderer('result', value, 'VAR_STRING', { enabled: true }); });
    expect(encodeClipboard([values])).toEqual(encoded); expect(encoded.typed).toContain('9007199254740993'); expect(values[4]).toEqual({ type: 'binary', base64: 'AP8=' });
  });
});
