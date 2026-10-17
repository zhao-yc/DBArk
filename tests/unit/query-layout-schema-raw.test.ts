import { expect, it } from 'vitest';
import { commandSchemas, validateCommand } from '../../src/shared/validation';

/** 只构造原型高度的RAM输入；不读环境、配置库、凭据或真实SQL。 */
it('导出的settings schema不应将继承高度转为自有；真实Main原始输入门仍须拒绝', () => {
  const tab = Object.assign(Object.create({ queryEditorHeight: 500 }), { id: 'ram-query', kind: 'query', title: '内存查询', connectionId: 'ram-connection', sql: '仅合成正文，不执行' });
  const input = { theme: 'dark', sidebarWidth: 270, resultLimit: 1000, pageSize: 200, tabs: [tab] };
  expect(() => validateCommand('settings.save', input)).toThrow('自有');
  const parsed = commandSchemas['settings.save'].safeParse(input);
  console.log('独审schema原始字段诊断', JSON.stringify({ rawOwnHeight: Object.hasOwn(tab, 'queryEditorHeight'), schemaAccepted: parsed.success, parsedOwnHeight: parsed.success && Object.hasOwn((parsed.data as any).tabs[0], 'queryEditorHeight') }));
  expect(parsed.success, '导出schema声称也执行共享门，但解析后已无法证明原始自有性').toBe(false);
});
