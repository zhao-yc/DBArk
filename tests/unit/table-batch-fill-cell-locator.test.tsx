import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { renderToStaticMarkup } from 'react-dom/server';
import * as jsxRuntime from 'react/jsx-runtime';
import ts from 'typescript';
import { expect, it } from 'vitest';

/** 从生产列头及专项函数取真实代码，仅替换定位端口，不加载Playwright或桌面。 */
function declaration(file: string, match: (node: ts.Node) => boolean): string {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8'), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = '';
  function visit(node: ts.Node) { if (match(node)) found = ts.isPropertyAssignment(node) ? node.initializer.getText(tree) : node.getText(tree); node.forEachChild(visit); }
  visit(tree); if (!found) throw Error('未找到真实定位或列头代码'); return found;
}
const compile = (source: string) => ts.transpileModule(source, { fileName: 'port.tsx', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;

it('生产note列头紧邻text类型且有同名前缀列时，专项仍选择note原列头坐标', async () => {
  const header = declaration('../../src/renderer/components/TableTab.tsx', node => ts.isPropertyAssignment(node) && node.name.getText() === 'renderHeaderCell');
  /** 真实JSX生成列头，保留列名与类型之间没有空白的失败条件。 */
  function markup(name: string) {
    const exports: Record<string, any> = {};
    runInNewContext(compile(`exports.render = (${header});`), { exports, column: { name, key: name, type: 'text' }, info: { primaryKey: [] }, require(name: string) { if (name === 'react/jsx-runtime') return jsxRuntime; throw Error('列头不应加载额外模块'); } });
    return renderToStaticMarkup(exports.render());
  }
  const headers = [{ html: markup('note_extra'), index: '3' }, { html: markup('note'), index: '4' }];
  const flattened = headers[1].html.replace(/<[^>]+>/g, '');
  expect(flattened).toBe('notetext'); expect(/^note(?:\s|$)/.test(flattened)).toBe(false);
  const table = { getByRole(role: string) {
    expect(role).toBe('columnheader');
    return { filter({ has }: { has: { selector: string } }) { return { async getAttribute(name: string) {
      // RAM端口只接纳本专项的直接文本XPath；从真实渲染取直接列名，不模拟浏览器XPath引擎。
      expect(has.selector).toBe('xpath=.//span[@class="data-header"]/span[text()="note"]'); expect(name).toBe('aria-colindex');
      const candidates = headers.filter(header => /<span>([^<]*)<small class="column-type">/.exec(header.html)?.[1] === 'note');
      expect(candidates).toHaveLength(1); expect(candidates[0]).toBe(headers[1]); return candidates[0].index;
    } }; } };
  } };
  const cell = declaration('../e2e/table-batch-fill-live.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'cell'), exports: Record<string, any> = {};
  runInNewContext(compile(cell + '\nexports.cell = cell;'), { exports, table, page: { locator: (selector: string) => ({ selector }) }, checked: (operation: () => Promise<unknown>) => operation() });
  const result = await exports.cell({ locator: (selector: string) => ({ selector }) }, 'note');
  expect(result).toEqual({ selector: '[role="gridcell"][aria-colindex="4"]' });
});
