import type * as monaco from 'monaco-editor';
import type { PostgresCompletionResult } from '../../src/shared/postgresCompletion';
import { createPostgresCompletionProvider } from '../../src/renderer/postgresCompletionProvider';
import { describe, expect, it } from 'vitest';
import { analyzePostgresCompletion } from '../../src/renderer/postgresCompletionAnalysis';

/** 测试使用竖线表示编辑器光标，其余 SQL 原样进入生产词法。 */
function at(marked: string) {
  const offset = marked.indexOf('|');
  return analyzePostgresCompletion(marked.slice(0, offset) + marked.slice(offset + 1), offset);
}

describe('PostgreSQL 补全词法和关系作用域', () => {
  it('关系位置读取 schema，引用前缀和后半个词使用完整替换范围', () => {
    expect(at('SELECT * FROM /* 说明 */ "业.务"."品|名"')).toMatchObject({ prefix: '品', quoted: true,
      query: { kind: 'relations', schema: '业.务' } });
    expect(at('SELECT * FROM "|')).toMatchObject({ prefix: '', quoted: true, query: { kind: 'relations' } });
    expect(at('SELECT * FROM "业""|')).toMatchObject({ prefix: '业"', query: { kind: 'relations' } });
    expect(at('SELECT * FROM ONLY s.ta|')).toMatchObject({ prefix: 'ta', query: { kind: 'relations', schema: 's' } });
    expect(at('SELECT * FROM s.t, q.|')).toMatchObject({ query: { kind: 'relations', schema: 'q' } });
  });
  it('从光标之后的 FROM 绑定别名，大小写、引号及跨 schema 连接保留原身份', () => {
    const sql = 'SELECT coalesce("客".na|me, NULL) FROM "甲"."主""表" AS "客" JOIN public.c AS C ON true';
    const result = at(sql)!;
    expect(result.prefix).toBe('na');
    expect(sql.replace('|', '').slice(result.start, result.end)).toBe('name');
    expect(result.query).toEqual({ kind: 'columns', qualified: true, relations: [{ schema: '甲', name: '主"表', alias: '客' }] });
    expect(at('SELECT c.| FROM public.A AS C')?.query).toEqual({ kind: 'columns', qualified: true, relations: [{ schema: 'public', name: 'a', alias: 'c' }] });
    expect(at('SELECT s.t.| FROM s.t')?.query).toEqual({ kind: 'columns', qualified: true, relations: [{ schema: 's', name: 't' }] });
    expect(at('SELECT t.| FROM s.t AS r')?.query).toBeUndefined();
    expect(at('INSERT INTO "甲".t (na|) VALUES (1)')?.query).toEqual({ kind: 'columns', qualified: false, relations: [{ schema: '甲', name: 't' }] });
  });
  it('字符串、嵌套注释、dollar 正文及参数不触发目录，复杂作用域不猜同名关系', () => {
    for (const input of ["SELECT 'x|z' FROM t", 'SELECT /* a /* b */ | */ FROM t',
      'SELECT $tag$ FROM x| $tag$ FROM t', 'SELECT $1| FROM t', 'SELECT -- FROM a|\nFROM t']) {
      expect(at(input)).toBeUndefined();
    }
    expect(at('WITH t AS (SELECT 1) SELECT t.| FROM t')?.query).toBeUndefined();
    expect(at('SELECT s.| FROM (SELECT * FROM t) AS s')?.query).toBeUndefined();
    expect(at('SELECT a.| FROM s.a AS a, q.b AS a')?.query).toBeUndefined();
    expect(at('SELECT * FROM s.t; SELECT a.| FROM q.b AS a')?.query).toEqual({
      kind: 'columns', qualified: true, relations: [{ schema: 'q', name: 'b', alias: 'a' }],
    });
  });
});


it('切走再返回原标签时丢弃迟到目录，并由原承诺串行收尾', async () => {
  const sql = 'SELECT * FROM test', position = { lineNumber: 1, column: sql.length + 1 } as monaco.Position;
  const disposable = { dispose() {} };
  const model = {
    getValue: () => sql, getValueLength: () => sql.length, getVersionId: () => 1,
    getOffsetAt: () => sql.length, getPositionAt: (offset: number) => ({ lineNumber: 1, column: offset + 1 }),
    isDisposed: () => false, onDidChangeContent: () => disposable,
  } as unknown as monaco.editor.ITextModel;
  const token: monaco.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => disposable };
  const pending: ((result: PostgresCompletionResult) => void)[] = [];
  const provider = createPostgresCompletionProvider({
    scope: { tabId: '原页', connectionId: '原连接', database: '原库', connectionVersion: 1 },
    model: () => model, position: () => position, current: () => true,
    request: () => new Promise(resolve => pending.push(resolve)),
    kinds: { schema: 1, table: 1, view: 1, column: 1, keyword: 1 },
    status: () => {},
  });
  const context = { triggerKind: 0 };
  try {
    const old = provider.provideCompletionItems(model, position, context, token);
    await expect.poll(() => pending.length).toBe(1);
    provider.invalidate();
    const latest = provider.provideCompletionItems(model, position, context, token);
    pending[0]({ items: [{ kind: 'table', schema: '旧', name: 'test_old' }], incomplete: false });
    expect((await old)?.suggestions).toEqual([]);
    await expect.poll(() => pending.length).toBe(2);
    pending[1]({ items: [{ kind: 'table', schema: '新', name: 'test_new' }], incomplete: false });
    expect((await latest)?.suggestions).toMatchObject([{ insertText: '"新"."test_new"' }]);
  } finally { provider.dispose(); }
});
