import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { tableRenameViewReferences, tableRenameViewsDependOn, tableRenameShowViewBody, readTableRenameViewDependencies, renameViewLimits, type RenameViewDefinition } from '../../src/engine/tableRenameViewDependencies';
import type { StructureTaskContext } from '../../src/engine/structureDefinition';

const mode = { dialect: 'mariadb' as const, mode: { ansiQuotes: false, noBackslashEscapes: false } };
const view = (table: string, definition: string, database = 'db'): RenameViewDefinition => ({ database, table, definition, charset: 'utf8mb4', collation: 'utf8mb4_bin' });
describe('旧库视图完整关系解析，非名称搜索或宽容补全', () => {
  it('同名列/别名/文字/注释/EXTRACT FROM均不产生虚假目标依赖', () => {
    const sql = "select `other`.`t` as `t`, 'from db.t JOIN t', extract(day from `ts`) from `db`.`other` as `t` /* join db.t */ where `t`.`name`='t'";
    expect(tableRenameViewReferences(sql, 'db', mode)).toEqual([{ database: 'db', table: 'other' }]);
    expect(tableRenameViewsDependOn([view('v', sql)], { database: 'db', table: 't' }, mode)).toBe(false);
    expect(tableRenameViewReferences("select '(',')',',','.' from `db`.`t` as `(` where s='JOIN'", 'db', mode)).toEqual([{ database: 'db', table: 't' }]);
    expect(tableRenameViewReferences('select 1 from DUAL', 'db', mode)).toEqual([]); expect(tableRenameViewReferences('select * from `dual`', 'db', mode)).toEqual([{ database: 'db', table: 'dual' }]);
  });
  it('JOIN/逗号/UNION/派生表/ON及WHERE子查询全部纳入真实关系图', () => {
    const sql = 'select * from (`db`.`a` a left join `db`.`b` b on exists(select 1 from `foreign`.`c`)) join (select * from `db`.`d` union all select * from `db`.`e`) q on q.id=a.id,`db`.`f` where id in (select id from `db`.`t`)';
    expect(tableRenameViewReferences(sql, 'db', mode)).toEqual(['db/a', 'db/b', 'foreign/c', 'db/d', 'db/e', 'db/f', 'db/t'].map(value => { const [database, table] = value.split('/'); return { database, table }; }));
  });
  it('括号UNION完整消费外层ORDER/LIMIT，排序子查询同样保留真实依赖', () => {
    const sql = '(select id from `db`.`a`) union all (select id from `db`.`b`) order by (select max(id) from `foreign`.`t`),id limit 2 offset 1';
    expect(tableRenameViewReferences(sql, 'db', mode)).toEqual([{ database: 'db', table: 'a' }, { database: 'db', table: 'b' }, { database: 'foreign', table: 't' }]);
    expect(tableRenameViewReferences('((select id from a) union all (select id from b)) order by id limit 0,2', 'db', mode)).toEqual([{ database: 'db', table: 'a' }, { database: 'db', table: 'b' }]);
    for (const tail of ['join db.t', 'order id', 'order by', 'limit 1 unknown_tail', 'order by id from db.t', 'order by id limit (select id from db.t)']) expect(() => tableRenameViewReferences('(select id from a) ' + tail, 'db', mode)).toThrow();
  });
  it('函数参数和算术前缀的子查询只按实际完整括号范围解析，不把整个表达式当SELECT', () => {
    const sql = 'select coalesce((select count(*) from `db`.`t`),0),((select count(*) from `other`.`s`)/2) from `db`.`harmless` group by id having coalesce((select count(*) from `foreign`.`u`),0)>0 order by id limit 1';
    expect(tableRenameViewReferences(sql, 'db', mode)).toEqual([{ database: 'db', table: 't' }, { database: 'other', table: 's' }, { database: 'db', table: 'harmless' }, { database: 'foreign', table: 'u' }]);
    expect(() => tableRenameViewReferences('select coalesce((values(1)),0) from a', 'db', mode)).toThrow('尚未证明');
  });
  it('CTE按实际作用域隐藏名字，限定库名仍是真实表；非递归自己与前向表不被吞掉', () => {
    expect(tableRenameViewReferences('with t as (select * from other) select * from t', 'db', mode)).toEqual([{ database: 'db', table: 'other' }]);
    expect(tableRenameViewReferences('with t as (select * from t),later as (select * from t) select * from later join db.t using(id)', 'db', mode)).toEqual([{ database: 'db', table: 't' }]);
    expect(tableRenameViewReferences('with a as (select * from t),t as (select * from other) select * from a', 'db', mode)).toEqual([{ database: 'db', table: 't' }, { database: 'db', table: 'other' }]);
    expect(tableRenameViewReferences('with recursive t(id) as (select id from anchor union all select id from t) select * from t', 'db', mode)).toEqual([{ database: 'db', table: 'anchor' }]);
    expect(tableRenameViewReferences('with t as (select * from outside) select * from (with t as (select * from inside) select * from t) q', 'db', mode)).toEqual([{ database: 'db', table: 'outside' }, { database: 'db', table: 'inside' }]);
  });
  it('跨库间接链、原型同名和带反引号名称精确匹配，不按子串或对象原型命中', () => {
    const values = [view('__proto__', 'select * from `foreign`.`v`'), view('v', 'select * from `db`.`t`', 'foreign'), view('constructor', 'select * from `db`.`not_t`')];
    expect(tableRenameViewsDependOn(values, { database: 'db', table: 't' }, mode)).toBe(true);
    expect(tableRenameViewsDependOn(values, { database: 'DB', table: 't' }, mode)).toBe(false);
    expect(tableRenameViewReferences('select * from `中``文`.`列``表`', 'db', mode)).toEqual([{ database: '中`文', table: '列`表' }]);
  });
  it('非递归影子、真实循环、未知表函数/关系/副作用/可执行注释和预算均明确拒绝', () => {
    expect(() => tableRenameViewsDependOn([view('a', 'select * from b'), view('b', 'select * from a')], { database: 'db', table: 't' }, mode)).toThrow('循环');
    for (const sql of ["select * from json_table('{}','$' columns(x int path '$')) q", 'select * from lateral(select * from t) q', 'select * from a unknown syntax t', 'select * from a partition(p)', 'select * from a;select * from t', 'select /*!50000 * from t */ 1', 'select * from a into outfile \'x\'', 'values(1)', 'select * from a join', 'select * from a using(x+1)']) expect(() => tableRenameViewReferences(sql, 'db', mode)).toThrow();
    expect(() => tableRenameViewReferences('select ' + '('.repeat(65) + '1' + ')'.repeat(65), 'db', mode)).toThrow('预算');
    expect(() => tableRenameViewReferences('select \'' + 'x'.repeat(renameViewLimits.definitionBytes) + '\'', 'db', mode)).toThrow('预算');
  });
  it('SHOW首部只定位真实视图名与AS，字符串AS/VIEW/ CHECK OPTION不会截正文', () => {
    const sql = "select 'VIEW AS WITH LOCAL CHECK OPTION' as `AS` from `db`.`other`";
    expect(tableRenameShowViewBody("CREATE ALGORITHM=UNDEFINED DEFINER=`VIEW`@`AS` SQL SECURITY DEFINER VIEW `db`.`v` AS " + sql + ' WITH LOCAL CHECK OPTION', { database: 'db', table: 'v' }, mode)).toBe(sql);
    expect(() => tableRenameShowViewBody('CREATE VIEW `db`.`other` AS ' + sql, { database: 'db', table: 'v' }, mode)).toThrow('名称');
  });
  it.each([{ ansiQuotes: false, noBackslashEscapes: true }, { ansiQuotes: true, noBackslashEscapes: false }, { ansiQuotes: true, noBackslashEscapes: true }])('旧库canonical反斜杠文字不随当前会话%j误分词', currentMode => {
    const sql = "select 'q\\'\\\\ from old_name' as `t` from `db`.`other`", context = { dialect: 'mariadb' as const, mode: currentMode };
    expect(tableRenameViewReferences(sql, 'db', context)).toEqual([{ database: 'db', table: 'other' }]);
    expect(tableRenameShowViewBody('CREATE VIEW `v` AS ' + sql, { database: 'db', table: 'v' }, context)).toBe(sql);
  });
  it.each([false, true])('SHOW真实ANSI首部/正文标识符正规化，NBE=%s不改canonical文字或字符串内引号', noBackslashEscapes => {
    const note = "'q\\'\\\\ from old_name \"quoted\" `untouched`'", canonical = 'select `a``b`.`id` AS `old_name`,' + note + ' AS `note` from `db`.`other` `a``b`';
    const show = 'CREATE ALGORITHM=UNDEFINED DEFINER="u"@"h" SQL SECURITY DEFINER VIEW "db"."v" AS select "a`b"."id" AS "old_name",' + note + ' AS "note" from "db"."other" "a`b"';
    const context = { dialect: 'mysql' as const, mode: { ansiQuotes: true, noBackslashEscapes } };
    expect(tableRenameShowViewBody(show, { database: 'db', table: 'v' }, context)).toBe(canonical);
    expect(tableRenameViewReferences(canonical, 'db', context)).toEqual([{ database: 'db', table: 'other' }]);
    expect(() => tableRenameShowViewBody(show, { database: 'db', table: 'v' }, { ...context, mode: { ...context.mode, ansiQuotes: false } })).toThrow('名称');
    expect(tableRenameShowViewBody(show.replace('q', 'changed'), { database: 'db', table: 'v' }, context)).not.toBe(canonical);
  });
});

/** 只替原驱动端口；完整生产reader执行TABLES/VIEWS分页、逐SHOW和前后清单重核。 */
function context(initial: RenameViewDefinition[], options: { missing?: boolean; definitionMismatch?: boolean; drift?: boolean; invisible?: boolean } = {}) {
  let values = [...initial], shows = 0; const sent: string[] = [], connection = new EventEmitter();
  Object.assign(connection, { query(sql: string, callback: Function) { sent.push(sql); queueMicrotask(() => {
    let rows: unknown;
    if (sql.startsWith('SELECT TABLE_SCHEMA')) {
      const definitions = sql.includes('information_schema.VIEWS'), hexes = [...sql.matchAll(/X'([0-9a-f]+)'/g)].map(match => Buffer.from(match[1], 'hex').toString()), last = hexes.length ? { database: hexes[0], table: hexes[2] } : undefined;
      rows = values.filter(value => !definitions || !options.missing || value.table !== 'v').sort((a, b) => Buffer.compare(Buffer.from(a.database), Buffer.from(b.database)) || Buffer.compare(Buffer.from(a.table), Buffer.from(b.table))).filter(value => !last || Buffer.compare(Buffer.from(value.database), Buffer.from(last.database)) > 0 || value.database === last.database && Buffer.compare(Buffer.from(value.table), Buffer.from(last.table)) > 0).slice(0, renameViewLimits.page + 1).map(value => ({ databaseName: value.database, viewName: value.table, ...(definitions ? { definition: options.invisible ? null : value.definition, charset: value.charset, collation: value.collation } : {}) }));
    } else if (sql.startsWith('SHOW CREATE VIEW')) {
      const names = [...sql.matchAll(/`((?:``|[^`])*)`/g)].map(match => match[1].replaceAll('``', '`')), value = values.find(value => value.database === names[0] && value.table === names[1])!;
      rows = [{ View: value.table, 'Create View': `CREATE ALGORITHM=UNDEFINED DEFINER=\`u\`@\`h\` SQL SECURITY DEFINER VIEW \`${value.table}\` AS ${options.definitionMismatch ? 'select 9' : value.definition}`, character_set_client: value.charset, collation_connection: value.collation }];
      shows++; if (options.drift && shows === values.length) values = [...values, view('new_external', 'select 1')];
    } else { callback(Error('未登记视图目录SQL：' + sql)); return; }
    callback(null, rows, []);
  }); } });
  return { sent, get shows() { return shows; }, managed: { connection, broken: false } as any, checkCancelled() {}, report() {}, commandStarted: () => () => {} } satisfies StructureTaskContext & { sent: string[]; shows: number };
}
describe('旧库完整可见全局视图来源证明', () => {
  it('系统100+视图及第二页后真正依赖均读取，不截前N；完整无关视图不封禁', async () => {
    const values = Array.from({ length: 150 }, (_, index) => view('v' + String(index).padStart(3, '0'), "select 't' as `t` from `performance_schema`.`threads`", 'sys'));
    const ctx = context(values), result = await readTableRenameViewDependencies(ctx, { database: 'db', table: 't' }, mode); expect(result.dependent).toBe(false); expect(ctx.shows).toBe(150); expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    const dependent = context([...values, view('z', 'select * from db.t', 'sys')]); expect((await readTableRenameViewDependencies(dependent, { database: 'db', table: 't' }, mode)).dependent).toBe(true); expect(dependent.shows).toBe(151);
  });
  it.each(['missing', 'definitionMismatch', 'drift', 'invisible'] as const)('%s不完整/矛盾来源不能当无依赖', async issue => {
    await expect(readTableRenameViewDependencies(context([view('v', 'select * from other')], { [issue]: true }), { database: 'db', table: 't' }, mode)).rejects.toThrow();
  });
  it('超全局清单预算在发送任何SHOW前拒绝，不返回前4096项为完整', async () => {
    const ctx = context(Array.from({ length: 4097 }, (_, index) => view('v' + String(index).padStart(4, '0'), 'select 1'))); await expect(readTableRenameViewDependencies(ctx, { database: 'db', table: 't' }, mode)).rejects.toThrow('预算'); expect(ctx.shows).toBe(0);
  });
  it('带getter目录标量不执行，不把异常对象序列化后给可写证明', async () => {
    const getter = vi.fn(() => 'select 1'), row = { databaseName: 'db', viewName: 'v', charset: 'utf8mb4', collation: 'utf8mb4_bin' }; Object.defineProperty(row, 'definition', { enumerable: true, get: getter });
    const ctx = context([]); Object.assign(ctx.managed.connection, { query(sql: string, callback: Function) { queueMicrotask(() => callback(null, sql.includes('information_schema.VIEWS') ? [row] : [{ databaseName: 'db', viewName: 'v' }], [])); } });
    await expect(readTableRenameViewDependencies(ctx, { database: 'db', table: 't' }, mode)).rejects.toThrow('标量'); expect(getter).not.toHaveBeenCalled();
  });
});
