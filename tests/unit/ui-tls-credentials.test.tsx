import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { zh, formatText } from '../../src/renderer/locales/zh-CN';
import { tlsCredentialsZh } from '../../src/renderer/locales/tlsCredentials.zh-CN';
import { tlsPassphraseMaxLength } from '../../src/shared/tlsCredentials';

const source = readFileSync(new URL('../../src/renderer/components/ConnectionDialog.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('ConnectionDialog.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
/** 读取正式SecretInput和TLS字段绑定，不在测试内另写清除/恢复或已存文案逻辑。 */
function component() {
  let secret = '', field: ts.JsxSelfClosingElement | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'SecretInput') secret = node.getText(file);
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file) === 'SecretInput' && node.getText(file).includes('tlsCredentialsZh.passphrase')) field = node;
    ts.forEachChild(node, visit);
  }
  visit(file); expect(secret).not.toBe(''); expect(field).toBeDefined();
  const context = createContext({ require: createRequire(import.meta.url), exports: {}, zh, formatText });
  runInContext(ts.transpileModule(secret + '\nglobalThis.Component=SecretInput;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  return { Component: context.Component, field: field! };
}

describe('正式TLS口令表单绑定与秘密输入', () => {
  it('真实字段关联TLS独立值和已存标记，并设置统一长度边界', () => {
    const { field } = component();
    const attributes = Object.fromEntries(field.attributes.properties.filter(ts.isJsxAttribute).map(attribute => [attribute.name.getText(file), attribute.initializer?.getText(file)]));
    expect(attributes).toMatchObject({ label: '{tlsCredentialsZh.passphrase}', value: '{tls.passphrase}', hasSaved: '{tls.hasPassphrase}', maxLength: '{tlsPassphraseMaxLength}', onChange: '{passphrase => setTls({ passphrase })}' });
  });
  it('已保存秘密不回显，密码类型、上限和明确清除/恢复沿用实际输入组件', () => {
    const { Component } = component(), onChange = vi.fn();
    const props = { label: tlsCredentialsZh.passphrase, value: undefined, hasSaved: true, maxLength: tlsPassphraseMaxLength, onChange };
    const html = renderToStaticMarkup(createElement(Component, props)); expect(html).toContain('type="password"'); expect(html).toContain('maxLength="1024"'); expect(html).toContain(zh.connections.text038);
    const changed = Component({ ...props, value: '待清除测试值' }) as ReactElement<{ children: unknown }>;
    const buttons: ReactElement<{ 'aria-label': string; onClick(): void }>[] = [];
    function visit(value: any) { if (Array.isArray(value)) value.forEach(visit); else if (value?.props) { if (value.type === 'button') buttons.push(value); visit(value.props.children); } }
    visit(changed);
    buttons.find(button => button.props['aria-label'] === formatText(zh.connections.text039, tlsCredentialsZh.passphrase))!.props.onClick(); expect(onChange).toHaveBeenLastCalledWith('');
    buttons.find(button => button.props['aria-label'] === formatText(zh.connections.text040, tlsCredentialsZh.passphrase))!.props.onClick(); expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(renderToStaticMarkup(createElement(Component, { ...props, value: '' }))).toContain(zh.connections.text037);
  });
});
