import { describe, expect, it } from 'vitest';
import type { ConnectionProfile } from '../../src/shared/contracts';
import { connectionDatabase, connectionOverview, sqliteFileName, sqliteSelectSource } from '../../src/renderer/sqliteWorkspace';
import { planSqlFormatting } from '../../src/renderer/sqlFormatting';

const profile: ConnectionProfile = { id: 'sqlite-fixture', name: '本机文件', group: '', color: '#52c5a2', dialect: 'sqlite', sqlite: { filePath: 'C:\\资料\\真实数据.sqlite', readOnly: true, busyTimeoutMs: 1000 } };

describe('SQLite 原工作区的文件目标与方言边界', () => {
  it('概要只摘取文件名，不读取网络变体字段', () => {
    const file = { ...profile };
    Object.defineProperty(file, 'host', { get() { throw Error('不能读取网络地址'); } });
    Object.defineProperty(file, 'user', { get() { throw Error('不能读取网络用户'); } });
    expect(connectionOverview(file)).toBe('SQLite · 真实数据.sqlite');
    expect(connectionDatabase(file)).toBe('main');
    expect(sqliteFileName('/用户/资料/文件.db')).toBe('文件.db');
  });
  it('表和库名中的双引号逐个转义，只生成带显式上限的查询草稿', () => {
    expect(sqliteSelectSource('ma"in', { name: '奇怪"表; DROP TABLE x;--' })).toBe('SELECT * FROM "ma""in"."奇怪""表; DROP TABLE x;--" LIMIT 100;');
  });
  it('SQLite 方言支持方括号标识符，字符串、双引号名称和注释保持原文', () => {
    const source = "select [order],\"奇怪表\",'反斜杠\\原文' from [含空格 表] where id=1;--无空格注释";
    const plan = planSqlFormatting(source, 0, source.length, '\n', { dialect: 'sqlite', keywordCase: 'preserve' })!;
    expect(plan.text).toContain('[order]'); expect(plan.text).toContain('"奇怪表"');
    expect(plan.text).toContain("'反斜杠\\原文'"); expect(plan.text).toContain('--无空格注释');
    expect(planSqlFormatting(plan.text, 0, plan.text.length, '\n', { dialect: 'sqlite', keywordCase: 'preserve' })).toBeNull();
  });
  it('未建立 SQLite 名称角色证明时拒绝显式改写大小写，不能落入 MySQL 解析器', () => {
    const source = 'select [order] from [表];';
    expect(() => planSqlFormatting(source, 0, source.length, '\n', { dialect: 'sqlite', keywordCase: 'upper' })).toThrow('SQLite 格式化暂仅支持保留关键字大小写');
    expect(() => planSqlFormatting(source, source.indexOf('order'), source.indexOf('order') + 2, '\n', { dialect: 'sqlite' })).toThrow('完整文本范围');
  });
});
