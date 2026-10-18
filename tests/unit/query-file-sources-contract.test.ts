import { describe, expect, it } from 'vitest';
import { assertQueryFileSourceSettings, queryFileSourceOpenSchema, queryFileSourceSaveAsSchema, queryFileSourceSaveSchema } from '../../src/shared/queryFileSources';
import { validateCommand } from '../../src/shared/validation';
const source = { id: '367cce95-2a1c-4e6f-9900-ae03d5ac0d07', revision: 1 };
describe('SQL文件来源合同', () => {
  it('打开与保存不接收renderer路径或展示字段', () => {
    expect(queryFileSourceOpenSchema.safeParse({ tabId: 'a', encoding: 'utf8', path: '任意路径' }).success).toBe(false);
    expect(queryFileSourceSaveSchema.safeParse({ tabId: 'a', source, sql: '', displayPath: '任意路径' }).success).toBe(false);
    expect(validateCommand('queryFileSources.save', { tabId: 'a', source, sql: 'select 1' })).toEqual({ tabId: 'a', source, sql: 'select 1' });
  });
  it('另存要求BOM匹配编码且不接受不支持的换行策略', () => {
    const value = { tabId: 'a', sql: '', encoding: 'gb18030', bom: 'utf8', eol: 'preserve' };
    expect(queryFileSourceSaveAsSchema.safeParse(value).success).toBe(false);
    expect(queryFileSourceSaveAsSchema.safeParse({ ...value, bom: 'none' }).success).toBe(true);
    expect(queryFileSourceSaveSchema.safeParse({ tabId: 'a', source, sql: '', eol: 'auto' }).success).toBe(false);
  });
  it('设置原始门拒绝table、显式undefined及继承字段，接受查询引用', () => {
    expect(() => assertQueryFileSourceSettings({ tabs: [{ kind: 'query', fileSourceBinding: source }] })).not.toThrow();
    for (const tab of [{ kind: 'table', fileSourceBinding: source }, { kind: 'query', fileSourceBinding: undefined }, Object.assign(Object.create({ fileSourceBinding: source }), { kind: 'query' })]) expect(() => assertQueryFileSourceSettings({ tabs: [tab] })).toThrow();
  });
});
