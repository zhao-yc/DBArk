import { describe, expect, it, vi } from 'vitest';
import { analyzeCompletionHover } from '../../src/shared/completionHoverAnalysis';
import { sqlFieldHover } from '../../src/renderer/sqlFieldHover';
import { SessionObjects } from '../../src/engine/sessionObjects';
import { SessionCompletionDirectory } from '../../src/renderer/sessionCompletionDirectory';
import type { CompletionMetadataOutput } from '../../src/shared/sqlCompletion';
import { sqlFieldHoverZh as text } from '../../src/renderer/locales/sqlFieldHover.zh-CN';

const details = { type: 'decimal(30,20)', nullable: false, defaultValue: '0.12345678901234567890', extra: '', comment: '字段备注 [执行](command:danger)\n<img src=x>\n```' };
/** 使用生产词法与AST；竖线只标记本地UTF-16悬停位置，不发送SQL给目录。 */
function analysis(marked: string, mode = {}) { return analyzeCompletionHover(marked.replace('|', ''), marked.indexOf('|'), mode, { lateralDerivedTables: true, windowFunctions: true, insertRowAliases: true }); }
function directory(name = 'amount', value = details) { return { load: vi.fn(async () => ({ entries: [{ name, kind: 'column' as const, dataType: 'decimal', visible: true, details: value }], incomplete: false })) }; }
async function hover(marked: string, database: string | null = 'db', port = directory(), mode = {}) { const result = analysis(marked, mode); return { result, port, content: result.status === 'ready' ? await sqlFieldHover(result, database ?? undefined, port) : undefined }; }

describe('字段悬停的真实作用域、目录与安全文本', () => {
  it('单词中间定位完整原token，字段信息精确而SQL不离开本地', async () => {
    const actual = await hover('SELECT u.am|ount FROM db.users u'); expect(actual.result.status).toBe('ready');
    if (actual.result.status !== 'ready') throw Error('未形成真实字段目标'); expect(actual.result.target.prefix).toBe('amount');
    expect(actual.port.load).toHaveBeenCalledExactlyOnceWith({ kind: 'columns', database: 'db', table: 'users', prefix: 'amount', details: true }, undefined);
    expect(actual.content).toContain('decimal(30,20)'); expect(actual.content).toContain('0.12345678901234567890'); expect(actual.content).toContain(text.nullable + '：' + text.no); expect(actual.content!.split('\n').every(line => line.startsWith('    '))).toBe(true);
  });
  it.each(["SELECT 'am|ount' FROM db.users", 'SELECT amount FROM db.users -- am|ount', 'SELECT |u.amount FROM db.users u', 'SELECT CO|UNT(*) FROM db.users', 'SELECT amount AS am|ount FROM db.users', 'SELECT u.| FROM db.users u'])('不是完整字段时零目录读取：%s', async source => { const actual = await hover(source); expect(actual.content).toBeUndefined(); expect(actual.port.load).not.toHaveBeenCalled(); });
  it('带点和转义反引号的名称始终是独立目录段', async () => {
    const port = directory('a.b`c'), actual = await hover('SELECT u.`a.b|``c` FROM `db.x`.`t.y` u', null, port);
    expect(actual.content).toContain('a.b`c'); expect(port.load).toHaveBeenCalledWith({ kind: 'columns', database: 'db.x', table: 't.y', prefix: 'a.b`c', details: true }, undefined);
  });
  it('未知默认库不读取配置库；显式库仍可定位，双引号须有确定模式', async () => {
    const unknown = await hover('SELECT u.am|ount FROM users u', null); expect(unknown.content).toBeUndefined(); expect(unknown.port.load).not.toHaveBeenCalled();
    expect((await hover('SELECT u.am|ount FROM db.users u', null)).content).toContain('decimal');
    expect((await hover('SELECT "am|ount" FROM db.users')).content).toBeUndefined();
    expect((await hover('SELECT "am|ount" FROM db.users', 'db', directory(), { ansiQuotes: true, noBackslashEscapes: true })).content).toContain('decimal');
  });
  it('同名未限定字段报告歧义，限定别名只读取一个来源', async () => {
    const port = directory('id'), ambiguous = await hover('SELECT i|d FROM db.users u JOIN db.orders o ON u.id=o.id', 'db', port);
    expect(port.load).toHaveBeenCalledTimes(2); expect(ambiguous.content).toContain(text.ambiguous); expect(ambiguous.content).not.toContain('decimal(30,20)');
    const one = directory('id'); expect((await hover('SELECT u.i|d FROM db.users u JOIN db.orders o ON u.id=o.id', 'db', one)).content).toContain('decimal'); expect(one.load).toHaveBeenCalledTimes(1);
  });
  it('计算投影和输出别名不借用原物理类型，单目录星号可转发且不包含隐藏列', async () => {
    const projected = await hover('WITH q AS (SELECT amount AS n FROM db.users) SELECT q.n| FROM q'); expect(projected.content).toContain(text.cte); expect(projected.content).not.toContain('decimal'); expect(projected.port.load).not.toHaveBeenCalled();
    const alias = await hover('SELECT amount+1 AS amount FROM db.users ORDER BY am|ount'); expect(alias.content).toContain(text.output); expect(alias.port.load).not.toHaveBeenCalled();
    expect((await hover('WITH q AS (SELECT * FROM db.users) SELECT q.am|ount FROM q')).content).toContain('decimal');
    const hidden = { load: vi.fn(async () => ({ entries: [{ name: 'amount', kind: 'column' as const, visible: false, details }], incomplete: false })) }; const parsed = analysis('WITH q AS (SELECT * FROM db.users) SELECT q.am|ount FROM q'); if (parsed.status !== 'ready') throw Error('未形成字段'); expect(await sqlFieldHover(parsed, 'db', hidden)).toBeUndefined();
  });
  it('临时遮蔽只用同会话缓存；未知目录不借永久表，ALTER后不能显示旧完整属性', async () => {
    const catalog = new SessionObjects(0), temporary = { ...details, type: 'int', comment: '临时字段' }; catalog.confirm('db', 'users', [{ name: 'amount', dataType: 'int', visible: true, details: temporary }]);
    const permanent = { load: vi.fn(async (): Promise<CompletionMetadataOutput> => { throw Error('不能读取永久同名表'); }) }, scoped = new SessionCompletionDirectory(permanent, async query => catalog.completion(query), catalog.revision), parsed = analysis('SELECT u.am|ount FROM db.users u'); if (parsed.status !== 'ready') throw Error('未形成字段');
    expect(await sqlFieldHover(parsed, 'db', scoped)).toContain('临时字段'); expect(permanent.load).not.toHaveBeenCalled();
    catalog.observe('ALTER TABLE db.users MODIFY amount BIGINT', 'db', { ansiQuotes: false, noBackslashEscapes: false }, 'mysql'); expect(catalog.completion({ kind: 'columns', database: 'db', table: 'users', prefix: 'amount', details: true }).entries[0]?.details).toBeUndefined();
    catalog.invalidate(); const uncertain = new SessionCompletionDirectory(permanent, async query => catalog.completion(query), catalog.revision); expect(await sqlFieldHover(parsed, 'db', uncertain)).toBeUndefined(); expect(permanent.load).not.toHaveBeenCalled();
  });
  it('取消、权限不足和不完整目录都不交付猜测信息', async () => {
    const parsed = analysis('SELECT am|ount FROM db.users'); if (parsed.status !== 'ready') throw Error('未形成字段'); const signal = new AbortController(), port = directory(); signal.abort(); expect(await sqlFieldHover(parsed, 'db', port, signal.signal)).toBeUndefined(); expect(port.load).not.toHaveBeenCalled();
    for (const value of [{ entries: [], incomplete: true }, { entries: [], incomplete: false, sessionUncertain: true }]) expect(await sqlFieldHover(parsed, 'db', { load: async () => value })).toBeUndefined();
    expect(await sqlFieldHover(parsed, 'db', { load: async () => { throw Error('权限不足'); } })).toBeUndefined();
  });
});
