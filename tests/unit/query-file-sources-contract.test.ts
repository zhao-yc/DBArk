import { describe, expect, it } from 'vitest';
import { assertQueryFileSourceSettings, queryFileSourceOpenSchema, queryFileSourceSaveAsSchema, queryFileSourceSaveSchema, queryFileSourceSqlDigest, queryFileSourceDigestPayload, queryFileSourceHasChanges } from '../../src/shared/queryFileSources';
import { validateCommand } from '../../src/shared/validation';
import { createHash } from 'node:crypto';
const taskId = 'c57b1521-fd1b-4f9e-9fb0-5dec1476d524';
const source = { id: '367cce95-2a1c-4e6f-9900-ae03d5ac0d07', revision: 1 };
describe('SQL文件来源合同', () => {
  it('最近文件只接收不透明ID，与重读互斥，列表和移除不接收路径', () => {
    expect(validateCommand('queryFileSources.open', { tabId: 'a', taskId, encoding: 'gb18030', recentId: source.id })).toMatchObject({ recentId: source.id });
    expect(() => validateCommand('queryFileSources.open', { tabId: 'a', taskId, encoding: 'utf8', recentId: source.id, source })).toThrow();
    expect(validateCommand('queryFileSources.recent', { tabId: 'a' })).toEqual({ tabId: 'a' });
    expect(() => validateCommand('queryFileSources.recent', { tabId: 'a', path: '任意路径' })).toThrow();
    expect(() => validateCommand('queryFileSources.forgetRecent', { tabId: 'a', recentId: source.id, path: '任意路径' })).toThrow();
  });
  it('打开与保存不接收renderer路径或展示字段', () => {
    expect(queryFileSourceOpenSchema.safeParse({ tabId: 'a', taskId, encoding: 'utf8', path: '任意路径' }).success).toBe(false);
    expect(queryFileSourceSaveSchema.safeParse({ tabId: 'a', taskId, source, sql: '', displayPath: '任意路径' }).success).toBe(false);
    expect(validateCommand('queryFileSources.save', { tabId: 'a', taskId, source, sql: 'select 1' })).toEqual({ tabId: 'a', taskId, source, sql: 'select 1' });
  });
  it('另存要求BOM匹配编码且不接受不支持的换行策略', () => {
    const value = { tabId: 'a', taskId, sql: '', encoding: 'gb18030', bom: 'utf8', eol: 'preserve' };
    expect(queryFileSourceSaveAsSchema.safeParse(value).success).toBe(false);
    expect(queryFileSourceSaveAsSchema.safeParse({ ...value, bom: 'none' }).success).toBe(true);
    expect(queryFileSourceSaveSchema.safeParse({ tabId: 'a', taskId, source, sql: '', eol: 'auto' }).success).toBe(false);
  });
  it('设置原始门拒绝table、显式undefined及继承字段，接受查询引用', () => {
    expect(() => assertQueryFileSourceSettings({ tabs: [{ kind: 'query', fileSourceBinding: source }] })).not.toThrow();
    for (const tab of [{ kind: 'table', fileSourceBinding: source }, { kind: 'query', fileSourceBinding: undefined }, { kind: 'query', fileSourceBinding: source, sourceBinding: { id: 'local' } }, Object.assign(Object.create({ fileSourceBinding: source }), { kind: 'query' })]) expect(() => assertQueryFileSourceSettings({ tabs: [tab] })).toThrow();
  });
  it('前端摘要精确使用完整UTF8，保留BOM字面字符和EOL，拒绝非法代理项替换碰撞', async () => {
    for (const sql of ['', '中文🚢\r\n', '\uFEFFx\n', 'x\r']) expect(await queryFileSourceSqlDigest(sql)).toBe(createHash('sha256').update(Buffer.from(sql, 'utf8')).digest('hex'));
    expect(await queryFileSourceSqlDigest('x\n')).not.toBe(await queryFileSourceSqlDigest('x\r\n'));
    for (const sql of ['\ud800', '\udfff', '\0']) { expect(() => queryFileSourceDigestPayload(sql)).toThrow(); await expect(queryFileSourceSqlDigest(sql)).rejects.toThrow(); }
    expect(queryFileSourceSaveSchema.safeParse({ tabId: 'a', taskId, source, sql: '\ud800' }).success).toBe(false);
  });
  it('显式BOM/EOL/编码改变即使SQL摘要相同也为dirty，cancel只接受任务身份', async () => {
    const baseline = { ref: source, name: 'a.sql', displayPath: '仅展示', encoding: 'utf8' as const, bom: 'none' as const, eol: 'lf' as const, savedSqlDigest: await queryFileSourceSqlDigest('x\n') };
    expect(await queryFileSourceHasChanges('x\n', baseline)).toBe(false);
    for (const format of [{ bom: 'utf8' as const }, { eol: 'crlf' as const }, { encoding: 'utf16le' as const }]) expect(await queryFileSourceHasChanges('x\n', baseline, format)).toBe(true);
    await expect(queryFileSourceHasChanges('\ud800', baseline)).rejects.toThrow();
    expect(validateCommand('queryFileSources.cancel', { tabId: 'a', taskId })).toEqual({ tabId: 'a', taskId });
    expect(() => validateCommand('queryFileSources.cancel', { tabId: 'a', taskId, path: '任意路径' })).toThrow();
  });
});
