import type * as monaco from 'monaco-editor';
import { readPostgresCompletion } from '../../src/engine/postgres/completion';
import type { PostgresConnection } from '../../src/engine/postgres/connection';
import type { PostgresCompletionInput, PostgresCompletionResult } from '../../src/shared/postgresCompletion';
import { createPostgresCompletionProvider } from '../../src/renderer/postgresCompletionProvider';
import { describe, expect, it } from 'vitest';
import { analyzePostgresCompletion, analyzePostgresSignature } from '../../src/renderer/postgresCompletionAnalysis';

/** 测试使用竖线表示编辑器光标，其余 SQL 原样进入生产词法。 */
function at(marked: string) {
  const offset = marked.indexOf('|');
  return analyzePostgresCompletion(marked.slice(0, offset) + marked.slice(offset + 1), offset);
}

it('参数定位识别最近调用、命名参数、数组和嵌套逗号', () => {
  const signature = (marked: string) => analyzePostgresSignature(marked.replace('|', ''), marked.indexOf('|'));
  expect(signature(`SELECT "工具"."Mix"(ARRAY[1, 2], nested('a,b', 4), "标记" => |)`)).toMatchObject({
    name: 'Mix', routine: { context: 'expression', schema: '工具' }, argument: 2, named: '标记', previousNames: [],
  });
  expect(signature('CALL tool.PROC(z => 1, a := |)')).toMatchObject({ name: 'proc', routine: { context: 'call', schema: 'tool' },
    argument: 1, named: 'a', previousNames: ['z'] });
  expect(signature('SELECT outer_call(ROUND(|), 1)')).toMatchObject({ name: 'round', argument: 0 });
  expect(signature('SELECT * FROM LATERAL tool.gen(|)')).toMatchObject({ routine: { context: 'from', schema: 'tool' } });
  expect(signature('SELECT outer_call($tag$x,y|$tag$, 1)')).toMatchObject({ name: 'outer_call', argument: 0 });
  for (const marked of ['CREATE FUNCTION public.f(|) RETURNS int', 'INSERT INTO public.t(|) VALUES (1)', 'SELECT 1; -- fake(|',
    'SELECT f(1); SELECT (|)']) expect(signature(marked)).toBeUndefined();
});

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
  it('字符串、嵌套注释、dollar 正文及参数不触发目录，同名别名不猜来源', () => {
    for (const input of ["SELECT 'x|z' FROM t", 'SELECT /* a /* b */ | */ FROM t',
      'SELECT $tag$ FROM x| $tag$ FROM t', 'SELECT $1| FROM t', 'SELECT -- FROM a|\nFROM t']) {
      expect(at(input)).toBeUndefined();
    }
    expect(at('SELECT a.| FROM s.a AS a, q.b AS a')?.query).toBeUndefined();
    expect(at('SELECT * FROM s.t; SELECT a.| FROM q.b AS a')?.query).toEqual({
      kind: 'columns', qualified: true, relations: [{ schema: 'q', name: 'b', alias: 'a' }],
    });
  });
  it('按声明顺序和引用大小写绑定 CTE，局部同名关系覆盖目录', () => {
    expect(at('WITH "订单"(编号) AS (VALUES (1)), total AS (SELECT 编号 AS 合计 FROM "订单") SELECT x.| FROM total x')?.query)
      .toMatchObject({ qualified: true, relations: [{ name: 'total', alias: 'x', projection: { names: ['合计'], stars: [] } }] });
    expect(at('WITH a AS (SELECT 1 AS value), b AS (SELECT * FROM |) SELECT * FROM b')?.query)
      .toEqual({ kind: 'relations', ctes: ['a'] });
    expect(at('WITH a AS (SELECT 1) SELECT t.| FROM public.a AS t')?.query)
      .toEqual({ kind: 'columns', qualified: true, relations: [{ schema: 'public', name: 'a', alias: 't' }] });
    expect(at('WITH a AS (SELECT 1 AS local_col) UPDATE a SET field = a.|')?.query)
      .toEqual({ kind: 'columns', qualified: true, relations: [{ name: 'a' }] });
    expect(at('WITH a AS (SELECT 1 AS outer_col) SELECT (WITH a AS (SELECT 1 AS inner_col) SELECT a.| FROM a)')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['inner_col'] } }] });
  });
  it('位置别名保留已知的后续投影，物理通配列只映射回派生关系', () => {
    expect(at('SELECT d.| FROM (SELECT 1, x.kept, ARRAY[1, 2] AS arr FROM real.x) AS d("首列")')?.query)
      .toMatchObject({ relations: [{ alias: 'd', projection: { names: ['首列', 'kept', 'arr'], stars: [] } }] });
    expect(at('WITH x AS (SELECT o.* FROM real.orders o) SELECT d.| FROM (SELECT * FROM x) d')?.query)
      .toMatchObject({ relations: [{ alias: 'd', projection: { stars: [{ schema: 'real', name: 'orders' }] } }] });
    expect(at('SELECT d.| FROM (SELECT * FROM t) d(alias_only)')?.query)
      .toMatchObject({ relations: [{ alias: 'd', projection: { names: ['alias_only'], stars: [] } }] });
    expect(at('WITH x AS (UPDATE t SET name = 1 RETURNING id AS changed) SELECT x.| FROM x')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['changed'], stars: [] } }] });
    expect(at('SELECT d.| FROM (SELECT a.*, b.* FROM a JOIN b USING (id)) d')?.query)
      .toMatchObject({ relations: [{ projection: { stars: [{ name: 'a' }, { name: 'b' }] } }] });
    expect(at('SELECT d.| FROM (SELECT * FROM a JOIN b USING (id)) d')?.query)
      .toMatchObject({ relations: [{ projection: { names: [], stars: [] } }] });
  });
  it('作用域跟随光标，区分普通派生表、LATERAL、相关子查询与集合分支', () => {
    expect(at('SELECT (SELECT p.| FROM child) FROM parent p')?.query)
      .toMatchObject({ relations: [{ name: 'parent', alias: 'p' }] });
    expect(at('SELECT (SELECT p.| FROM child p) FROM parent p')?.query)
      .toMatchObject({ relations: [{ name: 'child', alias: 'p' }] });
    expect(at('SELECT * FROM parent p, (SELECT p.|) d')?.query).toBeUndefined();
    expect(at('SELECT * FROM parent p, LATERAL (SELECT p.|) d')?.query)
      .toMatchObject({ relations: [{ name: 'parent', alias: 'p' }] });
    expect(at('SELECT a.id FROM first a UNION ALL SELECT a.| FROM second a')?.query)
      .toMatchObject({ relations: [{ name: 'second', alias: 'a' }] });
    expect(at('SELECT 1 AS first UNION ALL SELECT 2 AS second ORDER BY fi|')?.query)
      .toMatchObject({ relations: [{ projection: { names: ['first'] } }] });
    expect(at('WITH RECURSIVE t AS (SELECT 1 AS step UNION ALL SELECT t.| + 1 FROM t) SELECT * FROM t')?.query)
      .toMatchObject({ relations: [{ name: 't', projection: { names: ['step'], stars: [] } }] });
  });
  it('识别函数表达式、FROM 和 CALL，避开别名、列清单、赋值左侧和类型转换', () => {
    expect(at('SELECT "工具.甲"."混|合"(/* 间隔 */ 1)')).toMatchObject({ routine: { context: 'expression', schema: '工具.甲' }, existingCall: true });
    expect(at('SELECT * FROM LATERAL tool.gen|')).toMatchObject({ routine: { context: 'from', schema: 'tool' } });
    expect(at('CALL tool.bac|')).toMatchObject({ routine: { context: 'call', schema: 'tool' } });
    expect(at('CALL proc(upper(lo|))')?.routine).toEqual({ context: 'expression' });
    expect(at('SELECT 1 UNION ALL SELECT cou|')?.routine).toEqual({ context: 'expression' });
    expect(at('UPDATE t SET n=rou|')?.routine).toEqual({ context: 'expression' });
    for (const text of ['SELECT t.no| FROM s.t', 'INSERT INTO s.t (na|) VALUES (1)', 'UPDATE t SET a=1, na|',
      'SELECT * FROM a JOIN b USING (na|)', 'SELECT 1::te|', 'SELECT * FROM ONLY s.t|', 'DELETE FROM s.ta|']) {
      expect(at(text)?.routine).toBeUndefined();
    }
  });
});

/** 通过生产 provider 检查请求内容和插入文字。 */
function editor(marked: string, request: (input: PostgresCompletionInput) => Promise<PostgresCompletionResult>, sessionId?: string) {
  const offset = marked.indexOf('|');
  const sql = marked.replace('|', '');
  const position = { lineNumber: 1, column: offset + 1 } as monaco.Position;
  const disposable = { dispose() {} };
  const model = {
    getValue: () => sql, getValueLength: () => sql.length, getVersionId: () => 1,
    getOffsetAt: () => offset, getPositionAt: (index: number) => ({ lineNumber: 1, column: index + 1 }),
    isDisposed: () => false, onDidChangeContent: () => disposable,
  } as unknown as monaco.editor.ITextModel;
  const token: monaco.CancellationToken = { isCancellationRequested: false, onCancellationRequested: () => disposable };
  const provider = createPostgresCompletionProvider({
    scope: { tabId: '原页', connectionId: '原连接', database: '原库', connectionVersion: 1, sessionId },
    model: () => model, position: () => position, current: () => true,
    request,
    kinds: { schema: 1, table: 1, view: 1, column: 1, keyword: 1, routine: 1 },
    snippetRule: 4,
    status: () => {},
  });
  return { provider, suggest: () => provider.provideCompletionItems(model, position, { triggerKind: 0 }, token),
    signature: () => provider.signatureHelp.provideSignatureHelp(model, position, token, { triggerKind: 1, isRetrigger: false }) };
}

it('签名按名称或位置高亮，精确请求受原标签失效约束', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const response: PostgresCompletionResult = { incomplete: false, items: [
    { kind: 'routine', schema: '工具', name: 'Mix', arguments: '', returns: 'text', category: 'f', parameters: [
      { name: 'first', type: 'integer', mode: 'i', optional: false }, { name: 'second', type: 'text', mode: 'i', optional: true },
    ] }, { kind: 'routine', schema: '工具', name: 'Mix', arguments: '', returns: 'integer', category: 'f', parameters: [
      { name: 'other', type: 'integer', mode: 'i', optional: false },
    ] },
  ] };
  const named = editor('SELECT "工具"."Mix"(second => |)', async input => { inputs.push(input); return response; }, '原会话');
  const pending: ((result: PostgresCompletionResult) => void)[] = [];
  const old = editor('SELECT "工具"."Mix"(1, |)', () => new Promise(resolve => pending.push(resolve)));
  try {
    const current = (await named.signature())?.value;
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', sessionId: '原会话', kind: 'signatures', prefix: 'Mix',
      routine: { context: 'expression', schema: '工具' } }]);
    expect(current).toMatchObject({ activeParameter: 1, signatures: [{ activeParameter: 1 }] });
    const [signature] = current!.signatures;
    const range = signature.parameters[1].label as [number, number];
    expect(signature.label.slice(...range)).toBe('"second" text DEFAULT …');
    const lookup = old.signature();
    await expect.poll(() => pending.length).toBe(1);
    const latest = old.signature();
    expect(pending).toHaveLength(1);
    pending[0](response);
    expect(await lookup).toBeNull();
    await expect.poll(() => pending.length).toBe(2);
    old.provider.invalidate();
    pending[1](response);
    expect(await latest).toBeNull();
  } finally { named.provider.dispose(); old.provider.dispose(); }
});

it('本地投影不读取目录，同名物理列不可取代 CTE，通配结果使用外层别名', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const request = async (input: PostgresCompletionInput): Promise<PostgresCompletionResult> => {
    inputs.push(input);
    return { items: [{ kind: 'column', reference: 0, name: 'note', type: 'text' }], incomplete: false };
  };
  const local = editor('WITH t AS (SELECT 1 AS "对外") SELECT t.对| FROM t', request);
  const star = editor('WITH t AS (SELECT q.* FROM real.orders q) SELECT no| FROM t d, other e', request);
  const duplicate = editor('SELECT d.no| FROM (SELECT t.*, 1 AS note FROM t) d', request);
  try {
    expect((await local.suggest())?.suggestions).toMatchObject([{ insertText: '"对外"' }]);
    expect(inputs).toEqual([]);
    expect((await star.suggest())?.suggestions).toMatchObject([{ insertText: '"d"."note"', detail: 'text' }]);
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', prefix: 'no',
      kind: 'columns', routine: { context: 'expression' }, relations: [{ schema: 'real', name: 'orders' }, { name: 'other' }] }]);
    expect((await duplicate.suggest())?.suggestions).toEqual([]);
  } finally {
    local.provider.dispose();
    star.provider.dispose();
    duplicate.provider.dispose();
  }
});

it('切走再返回原标签时丢弃迟到目录，并由原承诺串行收尾', async () => {
  const pending: ((result: PostgresCompletionResult) => void)[] = [];
  const { provider, suggest } = editor('SELECT * FROM test|', () => new Promise(resolve => pending.push(resolve)));
  try {
    const old = suggest();
    await expect.poll(() => pending.length).toBe(1);
    provider.invalidate();
    const latest = suggest();
    pending[0]({ items: [{ kind: 'table', schema: '旧', name: 'test_old' }], incomplete: false });
    expect((await old)?.suggestions).toEqual([]);
    await expect.poll(() => pending.length).toBe(2);
    pending[1]({ items: [{ kind: 'table', schema: '新', name: 'test_new' }], incomplete: false });
    expect((await latest)?.suggestions).toMatchObject([{ insertText: '"新"."test_new"' }]);
  } finally { provider.dispose(); }
});

it('物理目录延后时保留本地 CTE 候选，并且只投递原会话', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const { provider, suggest } = editor('WITH x AS (SELECT 1 AS value) SELECT * FROM x|', async input => {
    inputs.push(input);
    return { items: [], incomplete: false, deferred: 'transaction' };
  }, '原会话');
  try {
    expect((await suggest())?.suggestions).toMatchObject([{ insertText: '"x"' }]);
    expect(inputs).toEqual([{ connectionId: '原连接', database: '原库', prefix: 'x',
      kind: 'relations', routine: { context: 'from' }, sessionId: '原会话' }]);
  } finally { provider.dispose(); }
});

it('按原会话请求重载，安全插入调用括号且保留现有括号', async () => {
  const inputs: PostgresCompletionInput[] = [];
  const request = async (input: PostgresCompletionInput): Promise<PostgresCompletionResult> => {
    inputs.push(input);
    return { incomplete: false, items: [{ kind: 'routine', schema: '工具', name: '算$"法', category: 'f', arguments: 'value integer', returns: 'bigint' },
      { kind: 'routine', schema: '工具', name: '算$"法', category: 'f', arguments: 'value text', returns: 'text' }] };
  };
  const fresh = editor('SELECT "工具".算|', request, '原会话');
  const existing = editor('SELECT "工具".算| /* 注释 */ (1)', request, '原会话');
  try {
    expect((await fresh.suggest())?.suggestions).toMatchObject([
      { label: { label: '算$"法', detail: '(value integer)', description: '工具 → bigint' }, insertText: '"算\\$""法"($0)', insertTextRules: 4 },
      { label: { detail: '(value text)' } },
    ]);
    expect(inputs[0]).toEqual({ connectionId: '原连接', database: '原库', sessionId: '原会话', prefix: '算', kind: 'routines',
      routine: { context: 'expression', schema: '工具' } });
    expect((await existing.suggest())?.suggestions).toMatchObject([{ insertText: '"算$""法"' }, { insertText: '"算$""法"' }]);
  } finally { fresh.provider.dispose(); existing.provider.dispose(); }
});

it('目录失败只回滚自己的读取事务，回滚失效时封住原会话', async () => {
  const input = { kind: 'relations', connectionId: '原连接', database: '原库', prefix: '' } as const;
  for (const rollbackFails of [false, true]) {
    const calls: string[] = [];
    let transactionOpen = false;
    const connection = {
      database: '原库', broken: false,
      state: () => ({ transactionKnown: true, transactionOpen }),
      query: async (sql: string) => {
        calls.push(sql.trim());
        if (sql.startsWith('BEGIN')) transactionOpen = true;
        if (sql.includes('WITH namespaces')) throw Error('原目录读取失败');
        if (sql === 'ROLLBACK') {
          if (rollbackFails) throw Error('原回滚失败');
          transactionOpen = false;
        }
        return { rows: [] };
      },
    } as unknown as PostgresConnection;
    await expect(readPostgresCompletion(connection, input, true)).rejects.toThrow(rollbackFails ? '原回滚失败' : '原目录读取失败');
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(connection.broken).toBe(rollbackFails);
    expect(transactionOpen).toBe(rollbackFails);
  }
});
