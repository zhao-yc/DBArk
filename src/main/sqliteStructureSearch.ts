import { join } from 'node:path';
import { definitionNavigationResult } from '../engine/definitionNavigation';
import type { StructureSearchState } from '../engine/structureSearchPages';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { sqliteSearchName, structureSearchLimits as limits, type StructureSearchHit, type StructureSearchPage } from '../shared/databaseSearch';
import { SavedQueryMatcher, SavedQueryMatchTimeout, type SqliteStructureMatch } from './savedQueryMatcher';
import { readSqliteCatalogDefinition } from './sqliteObjectDefinition';
import { sqliteExactTextProjection } from './sqliteTableBrowse';

type Candidate = { name: string; object: string; parent: 'table' | 'view' | 'trigger'; position: string };
const fold = (value: string) => value.replace(/[A-Z]/g, character => character.toLowerCase());
const exact = sqliteExactTextProjection;
const integer = (value: number) => ({ type: 'integer' as const, value: String(value) });

/** 只执行固定目录查询。每个结果带原生截断证据，不能把截断当成无命中。 */
async function rows(driver: SqliteDriverSession, sql: string, parameters: SqliteValue[], count: number, check: () => void) {
  check();
  const result: SqliteValue[][] = [];
  const read = await driver.execute(sql, { parameters, maxRows: count, maxBytes: limits.pageBytes, onBatch: batch => { result.push(...batch.rows); } });
  check();
  if (read.statements.length !== 1 || read.statements[0].truncated) throw Error('SQLite 搜索目录超出批次预算');
  return result;
}

function candidate(row: SqliteValue[]): Candidate {
  const [name, object, parent, position] = row;
  if (typeof name !== 'string' || typeof object !== 'string' || typeof position !== 'string' ||
      (parent !== 'table' && parent !== 'view' && parent !== 'trigger')) throw Error('SQLite 搜索目录对象身份无效');
  return { name, object, parent, position };
}

/** 每页持有同一个只读快照，续页重新核对文件和目录版本。正则在线程内运行且受单条时间预算约束。 */
export async function readSqliteStructureSearchPage(driver: SqliteDriverSession, state: StructureSearchState, check: () => void, beginCleanup: () => void, signal: AbortSignal): Promise<StructureSearchPage> {
  if (!driver.readOnly || !driver.identity) throw Error('SQLite 结构搜索需要独占只读文件会话');
  const { input } = state, { pattern } = input;
  const page: StructureSearchPage = { hits: [], failures: [], totalHits: state.total, completedScopes: state.scope,
    scopeCount: input.kinds.length, limitReached: false, stoppedOnError: false };
  let matcher: SavedQueryMatcher | undefined;
  const interrupt = () => { void matcher?.close().catch(() => {}); };
  const matches = async (source: string, locate = false): Promise<SqliteStructureMatch> => {
    if (pattern.mode === 'regexp') {
      if (!matcher || matcher.closed) {
        await matcher?.close();
        check();
        matcher = new SavedQueryMatcher(join(__dirname, 'savedQuerySearchWorker.cjs'), 500);
      }
      const hit = await matcher.matchSqliteStructure(source, pattern);
      if (!locate || !hit.matched) return hit;
      check();
      try { return await matcher.matchSqliteStructure(source, pattern, true); }
      catch (reason) {
        check();
        if (!(reason instanceof SavedQueryMatchTimeout)) throw reason;
        await matcher.close();
        check();
        return hit;
      }
    }
    const value = pattern.caseSensitive ? source : fold(source);
    const needle = pattern.caseSensitive ? pattern.text : fold(pattern.text);
    return { matched: pattern.mode === 'whole' ? value === needle : pattern.mode === 'prefix' ? value.startsWith(needle) : value.includes(needle) };
  };
  const definition = input.searchIn === 'definition';
  const bounded = () => page.hits.length >= limits.pageHits || state.total >= input.maxResults ||
    Buffer.byteLength(JSON.stringify(page)) >= limits.pageBytes - 16 * 1024;
  const advance = () => { state.scope++; delete state.after; };
  const fail = (kind: StructureSearchHit['kind'], reason: unknown, object?: string) => {
    check();
    if (!driver.isUsable) throw reason;
    page.failures.push({ database: 'main', kind, object: object?.slice(0, 256), message: (reason instanceof Error ? reason.message : String(reason)).slice(0, 512) });
    page.stoppedOnError = input.onError === 'stop';
  };

  check();
  signal.addEventListener('abort', interrupt, { once: true });
  try {
    await driver.execute('BEGIN');
    const [[version]] = await rows(driver, 'PRAGMA main.schema_version', [], 1, check);
    if (!version || typeof version !== 'object' || version.type !== 'integer') throw Error('SQLite 搜索目录版本无效');
    const identity = { ...driver.identity, schemaVersion: version.value };
    if (state.sqliteFile && JSON.stringify(state.sqliteFile) !== JSON.stringify(identity)) throw Error('SQLite 文件或目录已变化，请重新搜索');
    state.sqliteFile = identity;
    if (pattern.mode === 'regexp') await matches(''); // 空目录也须拒绝语法错误。
    let scanned = 0;
    for (let queries = 0; state.scope < page.scopeCount && !page.stoppedOnError && !bounded() && queries < limits.pageQueries; queries++) {
      const kind = input.kinds[state.scope];
      const fields = kind === 'column';
      const count = (definition ? limits.definitionPageObjects : limits.pageHits) - scanned;
      if (count <= 0) break;
      let object: string | undefined, candidates: Candidate[];
      try {
        if (fields) {
          const partial = state.after && state.after.name !== '';
          const query = partial ? 'name = ? COLLATE BINARY' : '(? IS NULL OR name COLLATE BINARY > ?)';
          const after = state.after?.object ?? null;
          const relations = await rows(driver, `SELECT ${exact('name')},type FROM main.sqlite_schema
            WHERE type IN ('table','view') AND substr(name,1,7) <> 'sqlite_' AND ${query}
            ORDER BY name COLLATE BINARY LIMIT 1`, partial ? [after] : [after, after], 1, check);
          if (!relations.length) { advance(); continue; }
          const [table, parent] = relations[0];
          if (typeof table !== 'string' || (parent !== 'table' && parent !== 'view')) throw Error('SQLite 字段所属对象无效');
          object = table;
          sqliteSearchName.parse(table);
          const columns = await rows(driver, `SELECT ${exact('name')},CAST(cid AS TEXT) FROM pragma_table_xinfo(?, 'main')
            WHERE hidden <> 1 AND cid > ? ORDER BY cid LIMIT ${count + 1}`,
            [table, integer(partial ? Number(state.after!.name) : -1)], count + 1, check);
          candidates = columns.map(([name, position]) => candidate([name, table, parent, position]));
        } else {
          const after = state.after?.object ?? null;
          const parent = kind === 'index' ? "'table'" : 'type';
          const target = kind === 'index' ? 'tbl_name' : 'name';
          const objects = await rows(driver, `SELECT ${exact('name')},${exact(target)},${parent},${exact('name')}
            FROM main.sqlite_schema WHERE type = ? AND substr(name,1,7) <> 'sqlite_'
            AND (? IS NULL OR name COLLATE BINARY > ?) ORDER BY name COLLATE BINARY LIMIT ${count + 1}`,
            [kind, after, after], count + 1, check);
          candidates = objects.map(candidate);
        }
      } catch (reason) {
        fail(kind, reason, object);
        if (object !== undefined) state.after = { object, name: '' }; else advance();
        continue;
      }
      let consumed = 0;
      for (const item of candidates.slice(0, count)) {
        if (bounded()) break;
        const after = { object: fields ? item.object : item.position, name: fields ? item.position : '' };
        scanned++;
        try {
          sqliteSearchName.parse(item.name); sqliteSearchName.parse(item.object);
          const source = definition ? await readSqliteCatalogDefinition(driver, item.name, kind === 'index' ? 'index' : item.parent, { check }) : item.name;
          const { matched, positions } = await matches(source, definition);
          check();
          if (matched) {
            const hit: StructureSearchHit = { database: 'main', dialect: 'sqlite', kind,
              object: item.object, name: item.name, parentKind: item.parent };
            if (definition) {
              hit.matchedIn = 'definition';
              let characters = 0; for (const _character of source) characters++;
              hit.definitionCharacters = characters;
              hit.definitionNavigation = definitionNavigationResult(source, pattern,
                { navigationText: fold(source), navigationNeedle: fold(pattern.text), regexpRanges: positions });
            }
            page.hits.push(hit); state.total++;
          }
        } catch (reason) { fail(kind, reason, item.name); }
        state.after = after;
        consumed++;
        if (page.stoppedOnError) break;
      }
      if (consumed === candidates.length && candidates.length <= count) {
        if (fields && object !== undefined) state.after = { object, name: '' }; else advance();
      }
    }
    if (definition) page.scannedDefinitions = state.scannedDefinitions = (state.scannedDefinitions ?? 0) + scanned;
    check();
    page.totalHits = state.total;
    page.completedScopes = state.scope;
    page.limitReached = !page.stoppedOnError && state.total >= input.maxResults && state.scope < page.scopeCount;
    return page;
  } finally {
    signal.removeEventListener('abort', interrupt);
    beginCleanup();
    try { await matcher?.close(); }
    finally { if (driver.isUsable && driver.transaction) await driver.execute('ROLLBACK'); }
  }
}
