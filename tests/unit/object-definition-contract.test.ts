import { describe, expect, it } from 'vitest';
import { assertObjectDefinitionOutput, objectDefinitionDdl, objectDefinitionInputSchema, objectDefinitionLimits } from '../../src/shared/objectDefinition';
import { validateCommand } from '../../src/shared/validation';

const request = { connectionId: '连接', sessionId: '会话', table: '表', taskId: 'object-definition:测试' };
const output = { request, database: '库', name: '表', kind: 'table', temporary: true, ddl: 'CREATE TEMPORARY TABLE `表` (`列` INT)', revision: 0 };

describe('对象完整定义跨进程边界', () => {
  it('只接受有界对象身份，不接收SQL、路径、凭据或隐藏字段', () => {
    expect(validateCommand('query.objectDefinition', request)).toEqual(request);
    for (const extra of [{ sql: 'SELECT 1' }, { filePath: 'secret' }, { password: 'secret' }, { profile: {} }]) expect(() => objectDefinitionInputSchema.parse({ ...request, ...extra })).toThrow();
    const hidden = { ...request }; Object.defineProperty(hidden, 'path', { value: 'secret' });
    expect(() => objectDefinitionInputSchema.parse(hidden)).toThrow();
    let reads = 0; const getter = { ...request }; Object.defineProperty(getter, 'table', { enumerable: true, get: () => { reads++; return '表'; } });
    expect(() => objectDefinitionInputSchema.parse(getter)).toThrow(); expect(reads).toBe(0);
  });
  it('名称保留完整Unicode，拒绝孤立代理、NUL、超长和错误任务用途', () => {
    expect(objectDefinitionInputSchema.parse({ ...request, table: '😀'.repeat(256) }).table).toHaveLength(512);
    for (const table of ['', 'a'.repeat(513), '\ud800', 'a\0b']) expect(() => objectDefinitionInputSchema.parse({ ...request, table })).toThrow();
    for (const taskId of ['任意任务', 'object-definition:', 'object-definition:' + 'a'.repeat(200)]) expect(() => objectDefinitionInputSchema.parse({ ...request, taskId })).toThrow();
  });
  it('完整定义按真实UTF8预算处理，NUL原文不截断或编码替换', () => {
    expect(objectDefinitionDdl('a'.repeat(objectDefinitionLimits.ddlBytes))).toBe(true);
    expect(objectDefinitionDdl('中'.repeat(Math.floor(objectDefinitionLimits.ddlBytes / 3) + 1))).toBe(false);
    expect(objectDefinitionDdl('CREATE TABLE t(a TEXT COMMENT \'\0\')')).toBe(true);
    expect(objectDefinitionDdl('CREATE TABLE t(a TEXT COMMENT \'\ud800\')')).toBe(false);
  });
  it('确认包必须绑定原请求和完整定义，拒绝额外字段及非安全修订号', () => {
    expect(() => assertObjectDefinitionOutput(output, request)).not.toThrow();
    for (const patch of [{ request: { ...request, taskId: 'object-definition:别的' } }, { name: '别的表' }, { revision: -1 }, { profile: {} }, { ddl: 'a'.repeat(objectDefinitionLimits.ddlBytes + 1) }]) expect(() => assertObjectDefinitionOutput({ ...output, ...patch }, request)).toThrow();
  });
  it('SQLite仅按ASCII核对目录名和真实对象名，不接attached或Unicode折叠冒名', () => {
    const sqlite = { ...request, database: 'MaIn', table: 'Subject' };
    const result = { ...output, request: sqlite, database: 'main', name: 'subject', temporary: false };
    expect(() => assertObjectDefinitionOutput(result, sqlite, 'sqlite')).not.toThrow();
    expect(() => assertObjectDefinitionOutput({ ...result, database: 'attached' }, sqlite, 'sqlite')).toThrow();
    const unicode = { ...sqlite, table: 'Ä' };
    expect(() => assertObjectDefinitionOutput({ ...result, request: unicode, name: 'ä' }, unicode, 'sqlite')).toThrow();
  });
});
