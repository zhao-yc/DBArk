import { describe, expect, it } from 'vitest';
import { currentPostgresStatement, firstPostgresStatement, postgresRelationSelect, splitPostgresSql } from '../../src/shared/postgresSql';
import { parseConnectionUri } from '../../src/shared/connectionUri';
import { exportConnectionProfile, exportedConnectionSchema, importConnectionProfile, importReplacementProfile } from '../../src/shared/connectionTransfer';
import type { PostgresConnectionProfile } from '../../src/shared/contracts';

describe('PostgreSQL查询边界', () => {
  it('原始偏移跳过嵌套注释、Unicode标签、转义字符串、标识符及CR行注释', () => {
    const script = String.raw`/* 外 /* 内 ; $9 */ 外 */ SELECT $标签$😀;$8$标签$, E'a\';$7', "列;""$6", $2, $1, $2;` +
      '-- ; $5\rSELECT 2;';
    const [first, second] = splitPostgresSql(script);
    expect(first).toMatchObject({ start: 0, parameters: [1, 2], keyword: 'SELECT' });
    expect(script.slice(first.start, first.end)).toBe(first.sql);
    expect(second).toMatchObject({ sql: '-- ; $5\rSELECT 2', parameters: [] });
    expect(currentPostgresStatement(script, script.indexOf('2;')).sql).toBe(first.sql);
    expect(currentPostgresStatement(script, script.lastIndexOf('2;')).sql).toBe(second.sql);
  });

  it('逐句使用服务器模式，前句修改字符串模式后才解析后句', () => {
    const sql = String.raw`SET standard_conforming_strings = off; SELECT 'a\';b'; SELECT 3;`;
    const first = firstPostgresStatement(sql)!;
    const rest = sql.slice(first.end + 1);
    expect(first.keyword).toBe('SET');
    expect(splitPostgresSql(rest, false).map(statement => statement.sql.trim())).toEqual([String.raw`SELECT 'a\';b'`, 'SELECT 3']);
    expect(() => splitPostgresSql(rest, true)).toThrow('引用未闭合');
  });

  it('捕获COPY并拒绝未闭合边界，目录复合名与任意输入均经标识符引用', () => {
    expect(firstPostgresStatement(' ; /* COPY */ CoPy t FROM STDIN')?.keyword).toBe('COPY');
    expect(() => splitPostgresSql('SELECT $标记$未闭合')).toThrow('dollar-quote未闭合');
    expect(() => splitPostgresSql('SELECT 1\0;')).toThrow('包含NUL');
    expect(postgresRelationSelect('"自定义"."带""引号"')).toBe('SELECT * FROM "自定义"."带""引号" LIMIT 1000;');
    expect(postgresRelationSelect('t"; DROP TABLE t; --')).toBe('SELECT * FROM "t""; DROP TABLE t; --" LIMIT 1000;');
  });
});

describe('PostgreSQL连接交换边界', () => {
  it('支持两个URI别名与默认5432，SSL参数须明确配置', () => {
    expect(parseConnectionUri('postgres://角色:p%40ss@localhost/数据')).toEqual({
      dialect: 'postgresql', user: '角色', password: 'p@ss', host: 'localhost', port: 5432, database: '数据',
    });
    expect(parseConnectionUri('postgresql://user@[::1]:15432/db')).toMatchObject({ host: '::1', port: 15432 });
    expect(() => parseConnectionUri('postgresql://user@host/db?sslmode=require')).toThrow('不接受查询参数');
  });

  it('交换文件保留PostgreSQL目标和证书文件名，拒绝秘密及跨家族替换', () => {
    const profile: PostgresConnectionProfile = {
      id: 'pg', name: '本地测试', group: '', color: '#123456', dialect: 'postgresql',
      host: 'localhost', port: 5432, user: 'app', database: 'db', password: '测试秘密', rememberPassword: true,
      tls: { enabled: true, rejectUnauthorized: true, caPath: '/private/ca.crt', passphrase: '证书秘密' },
    };
    const exported = exportConnectionProfile(profile);
    expect(exported.tls).toEqual({ enabled: true, rejectUnauthorized: true, caFileName: 'ca.crt' });
    expect(JSON.stringify(exported)).not.toMatch(/秘密|private/);
    expect(exportedConnectionSchema.safeParse({ ...exported, password: '不应接受' }).success).toBe(false);
    expect(importConnectionProfile(exported, 'new')).toMatchObject({ id: 'new', dialect: 'postgresql', pendingFiles: ['tlsCa'], rememberPassword: false });
    expect(() => importReplacementProfile(exported, { ...exported, dialect: 'mysql' })).toThrow('其他数据库类型');
  });
});
