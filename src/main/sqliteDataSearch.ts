import { createHash } from 'node:crypto';
import type { DataSearchReferences, RecordPreparation } from '../engine/dataSearchReferences';
import type { DataSearchScanSource } from '../engine/dataSearchScans';
import { sqliteSearchFunctions as functions, sqliteSearchValueBytes, sqliteSearchKeyRawBytes } from '../engine/sqlite/dataSearchFunctions';
import type { SqliteDriverSession } from '../engine/sqlite/session';
import type { SqliteValue } from '../engine/sqlite/protocol';
import { dataSearchLimits as limits, sqliteDataSearchTargetSchema, type DataSearchInput, type DataSearchRow,
  type DataSearchTarget, type DataSearchTargetMetadata, type SqliteSearchKey } from '../shared/dataSearch';
import { dataSearchCatalogueLimits as catalogueLimits, type DataSearchCatalogueInput, type DataSearchCataloguePage,
  type DataSearchCatalogueEntry } from '../shared/dataSearchCatalogue';
import { dataSearchRecordLimits as recordLimits, type DataSearchRecord } from '../shared/dataSearchRecords';
import { sqliteSearchName } from '../shared/databaseSearch';
import { chooseSqliteTableLocator } from './sqliteTableEdit';
import { quoteSqliteIdentifier as quote, readSqliteTableCatalogue, readSqliteTableRows as rows, sqliteExactTextProjection as exact,
  withSqliteReadSnapshot, type SqliteTableBrowseControl } from './sqliteTableBrowse';

type Read = <T>(action: (driver: SqliteDriverSession, control: SqliteTableBrowseControl) => Promise<T>) => Promise<T>;
const integer = (value: number) => ({ type: 'integer' as const, value: String(value) });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const raw = (name: string) => 'CAST(' + name + ' AS BLOB)';
const bytes = (name: string) => 'length(' + raw(name) + ')';
const keyArgs = (name: string) => `typeof(${name}),${raw(name)},CASE WHEN typeof(${name}) IN ('integer','real') THEN ${name} END`;
const declaredBlob = (value: string) => /^\s*BLOB\b/i.test(value);
const isDigest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const visibleRelation = "schema='main' AND type IN ('table','view') AND substr(name,1,7) <> 'sqlite_'";

/** 对象种类和可见范围在同一只读快照复核。不会扫描 virtual、shadow 或临时对象。 */
async function relationKind(driver: SqliteDriverSession, table: string, control: SqliteTableBrowseControl) {
  const [[kind] = []] = await rows(driver, `SELECT type FROM pragma_table_list WHERE ${visibleRelation} AND name=? COLLATE BINARY`, [table], 1, control);
  if (kind !== 'table' && kind !== 'view')
    throw Error('SQLite 搜索对象不存在或超出普通表、视图范围');
  return kind;
}

export function readSqliteDataSearchCatalogue(driver: SqliteDriverSession, input: DataSearchCatalogueInput, control: SqliteTableBrowseControl): Promise<DataSearchCataloguePage> {
  return withSqliteReadSnapshot(driver, control, async () => {
    if (input.kind === 'databases') return { kind: input.kind,
      entries: !input.after && 'main'.startsWith(input.prefix) ? [{ name: 'main', kind: 'database' }] : [], hasMore: false };
    const count = catalogueLimits.entries + 1;
    let entries: DataSearchCatalogueEntry[];
    if (input.kind === 'objects') {
      const after = input.after ?? null;
      const objects = await rows(driver, `SELECT ${exact('name')},type FROM pragma_table_list WHERE ${visibleRelation}
        AND substr(name,1,length(?)) COLLATE BINARY=? AND (? IS NULL OR name COLLATE BINARY>?)
        ORDER BY name COLLATE BINARY LIMIT ${count}`, [input.prefix, input.prefix, after, after], count, control, undefined, catalogueLimits.pageBytes);
      entries = objects.map(([name, kind]) => {
        if (kind !== 'table' && kind !== 'view') throw Error('SQLite 搜索对象目录无效');
        return { name: sqliteSearchName.parse(name), kind };
      });
    } else {
      const kind = await relationKind(driver, input.table, control);
      if (kind !== input.objectKind) throw Error('SQLite 搜索对象类型已变化，请重新读取目录');
      const columns = await rows(driver, `SELECT ${exact('name')},type,cid+1 FROM pragma_table_xinfo(?, 'main')
        WHERE hidden<>1 AND cid+1>? AND substr(name,1,length(?)) COLLATE BINARY=?
        ORDER BY cid LIMIT ${count}`, [input.table, integer(Number(input.after ?? 0)), input.prefix, input.prefix],
        count, control, undefined, catalogueLimits.pageBytes);
      entries = columns.map(([name, dataType, ordinal]) => {
        if (typeof dataType !== 'string' || !ordinal || typeof ordinal !== 'object' || ordinal.type !== 'integer') throw Error('SQLite 搜索字段目录无效');
        return { name: sqliteSearchName.parse(name), kind: 'column', dataType: dataType || 'SQLite', binary: declaredBlob(dataType), ordinal: Number(ordinal.value) };
      });
    }
    const hasMore = entries.length === count;
    if (hasMore) entries.pop();
    const last = entries.at(-1);
    return { kind: input.kind, entries, hasMore, ...(hasMore && last ? { next: last.ordinal ? String(last.ordinal) : last.name } : {}) };
  });
}

async function inspect(driver: SqliteDriverSession, rawTarget: DataSearchTarget, allowViews: boolean, control: SqliteTableBrowseControl) {
  const target = sqliteDataSearchTargetSchema.parse(rawTarget);
  const kind = await relationKind(driver, target.table, control);
  if (kind !== target.kind || (kind === 'view' && !allowViews)) throw Error('SQLite 搜索对象类型已变化或视图尚未确认');
  const catalogue = await readSqliteTableCatalogue(driver, target.table, control);
  const fields = new Map(catalogue.columns.map(column => [column.name, column]));
  const notNull = new Map(catalogue.xinfo.map(row => [row[1], row[3]]));
  const describe = (name: string) => {
    const column = fields.get(name);
    if (!column) throw Error('SQLite 搜索字段已变化，请重新读取目录');
    const flag = notNull.get(name);
    return { name, dataType: column.declaredType || 'SQLite', binary: declaredBlob(column.declaredType),
      nullable: !(flag && typeof flag === 'object' && flag.type === 'integer' && flag.value === '1') };
  };
  const { locator } = await chooseSqliteTableLocator(driver, target.table, catalogue, control);
  const names = locator?.rowid ? [locator.rowid] : locator?.columns ?? [];
  const keyColumns = locator?.rowid ? [{ name: locator.rowid, dataType: 'INTEGER', nullable: false, binary: false }] : names.map(describe);
  const metadata: DataSearchTargetMetadata = { target, columns: target.columns.map(column => describe(column.name)), keyColumns,
    indexMetadataIncomplete: false, ...(!keyColumns.length ? { keyUnavailableReason: 'no-key' } : {}) };
  const [[version]] = await rows(driver, 'PRAGMA main.schema_version', [], 1, control);
  const identity = driver.identity;
  if (!identity || !version || typeof version !== 'object' || version.type !== 'integer') throw Error('SQLite 搜索文件身份不完整');
  const prepared: RecordPreparation = locator ? { identity: { server: digest(identity), tableId: version.value,
    definition: digest([catalogue.schemaKey, locator]) } } : { reason: 'no-key' };
  return { metadata, names, locator, prepared, columns: catalogue.columns.map(column => column.name) };
}

/** 二分拼接避免宽表命中把 SQLite 表达式树推过原生深度上限。 */
function concatenate(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  const split = Math.floor(parts.length / 2);
  return '(' + concatenate(parts.slice(0, split)) + '||' + concatenate(parts.slice(split)) + ')';
}
function stamp(names: string[]) {
  const parts = names.map(name => {
    const column = quote(name);
    return `CASE WHEN ${column} IS NULL OR ${bytes(column)}<=${sqliteSearchValueBytes}
      THEN ${functions.fieldStamp}(${keyArgs(column)}) END`;
  });
  return `${functions.rowStamp}(${concatenate(parts)})`;
}

type Preview = { text: string; characters: string; truncated: boolean; binary?: boolean };
function decodePreview(value: SqliteValue): Preview {
  if (typeof value !== 'string') throw Error('SQLite 搜索预览回包无效');
  const item = JSON.parse(value) as Preview;
  if (typeof item.text !== 'string' || !/^\d+$/.test(item.characters) || typeof item.truncated !== 'boolean')
    throw Error('SQLite 搜索预览回包无效');
  return item;
}
function readKeys(values: SqliteValue[]): SqliteSearchKey[] | undefined {
  if (values.some(value => typeof value !== 'string') || Buffer.byteLength(JSON.stringify(values)) > limits.keyBytes) return;
  return values.map(value => {
    const pair = JSON.parse(value as string) as SqliteSearchKey;
    if (!Array.isArray(pair) || pair.length !== 2 || !['text','blob','integer','real'].includes(pair[0]) || typeof pair[1] !== 'string')
      throw Error('SQLite 搜索定位键无效');
    return pair;
  });
}

/** 只读进程只发布有界预览。等待上层确认期间暂停 SQLite 原生帧确认及读取期限。 */
export function sqliteDataSearchSource(input: DataSearchInput, references: DataSearchReferences, read: Read, check: () => void,
  isBroken: () => boolean): DataSearchScanSource {
  const pattern = input.matcher.kind === 'text' ? input.matcher.pattern : undefined;
  if (pattern?.mode === 'regexp') {
    try { new RegExp(pattern.text, pattern.caseSensitive ? 'u' : 'iu'); }
    catch { throw Error('SQLite 本地 Unicode 正则无效'); }
  }
  return { checkCancelled: check, broken: isBroken, async read(target, maximum, open, peak) {
    await read((driver, control) => withSqliteReadSnapshot(driver, control, async () => {
      const selected = await inspect(driver, target, input.allowViews, control);
      const { metadata, names, prepared } = selected;
      const count = metadata.columns.length;
      const values = target.columns.map(column => {
        const name = quote(column.name);
        return pattern ? `${functions.match}(typeof(${name}),CASE WHEN ${bytes(name)}<=${sqliteSearchValueBytes} THEN ${raw(name)} END,
          ${column.representation === 'hex' ? 1 : 0},?1,${limits.previewCharacters})` : `CASE WHEN ${name} IS NULL THEN '{}' END`;
      });
      const keys = names.map(name => {
        const column = quote(name);
        return `CASE WHEN ${bytes(column)}<=${sqliteSearchKeyRawBytes} THEN ${functions.key}(${keyArgs(column)}) END`;
      });
      const sql = 'SELECT ' + [...values, ...keys, ...(keys.length ? [stamp(selected.columns)] : [])].join(',') +
        ' FROM main.' + quote(target.table) + ' WHERE ' + values.map(value => '(' + value + ' IS NOT NULL)').join(' OR ') + ' LIMIT ' + maximum;
      const receive = open(metadata, row => references.capture(input.connectionId, input.taskId, metadata, row, prepared));
      let consumerError: unknown, timeout = false, timer: ReturnType<typeof setTimeout> | undefined;
      const disarm = () => clearTimeout(timer);
      const arm = () => {
        timer = setTimeout(() => { timeout = true; void driver.cancel().catch(() => {}); }, pattern?.mode === 'regexp' ? 5000 : 30000);
        timer.unref();
      };
      arm();
      try {
        const result = await driver.streamRead(sql, { parameters: pattern ? [JSON.stringify(pattern)] : [], batchRows: 8,
          onBatch: async batch => {
            disarm();
            try {
              peak(batch.rows.length, Buffer.byteLength(JSON.stringify(batch.rows)));
              for (const row of batch.rows) {
                check();
                const cells = row.slice(0, count).map(value => {
                  if (value === null || !pattern) return { matched: value !== null, preview: null, characters: null, truncated: false };
                  const { text, characters, truncated } = decodePreview(value);
                  return { matched: true, preview: text, characters, truncated };
                });
                const stampValue = row[count + keys.length], rawKeys = keys.length && isDigest(stampValue) ? readKeys(row.slice(count, count + keys.length)) : undefined;
                const hit: DataSearchRow = { cells, keyValues: rawKeys?.map(([kind, value]) => kind === 'blob' || kind === 'text' ? { type: 'binary', base64: value } : value) ?? null,
                  ...(rawKeys && isDigest(stampValue) ? { sqliteIdentity: { keys: rawKeys, stamp: stampValue } } : {}) };
                await receive(hit);
              }
            } catch (reason) { consumerError = reason; throw reason; }
            arm();
          } });
        if (result.statements.length !== 1 || result.statements[0].truncated) throw Error('SQLite 数据搜索未收到完整批次');
      } catch (reason) {
        if (consumerError) throw consumerError;
        if (timeout) throw Error('SQLite 数据搜索读取超时，原操作已停止');
        throw reason;
      } finally { disarm(); }
    }));
  } };
}

export function readSqliteDataSearchRecord(driver: SqliteDriverSession, entry: ReturnType<DataSearchReferences['lookup']>,
  control: SqliteTableBrowseControl): Promise<DataSearchRecord> {
  return withSqliteReadSnapshot(driver, control, async () => {
    const { sqliteIdentity } = entry;
    if (!sqliteIdentity) throw Error('记录定位方言与保存的连接不匹配');
    const selected = await inspect(driver, entry.metadata.target, false, control);
    if (!selected.locator || 'reason' in selected.prepared || JSON.stringify(selected.prepared.identity) !== JSON.stringify(entry.identity) ||
        JSON.stringify(selected.metadata) !== JSON.stringify(entry.metadata) || selected.names.length !== sqliteIdentity.keys.length)
      throw Error('SQLite 原文件或表目录已变化，请重新搜索');
    const columns = [...selected.metadata.columns, ...selected.metadata.keyColumns.filter(key => !selected.metadata.columns.some(column => key.name === column.name))];
    const width = Math.min(recordLimits.fieldCharacters, Math.floor((recordLimits.recordBytes - 16384) / (12 * columns.length)));
    const projection = columns.map(column => `${functions.preview}(typeof(${quote(column.name)}),${raw(quote(column.name))},${width})`);
    const parameters: SqliteValue[] = [];
    const where = selected.names.map((name, index) => {
      const column = quote(name), [kind, value] = sqliteIdentity.keys[index];
      const key = kind === 'text' || kind === 'blob' ? { type: 'binary' as const, base64: value } : { type: kind, value };
      parameters.push(kind, key);
      return `(typeof(${column})=? AND ${column} COLLATE ${quote(selected.locator!.collations[index])} IS ${kind === 'text' ? 'CAST(? AS TEXT)' : '?'})`;
    }).join(' AND ');
    const matches = await rows(driver, 'SELECT ' + [...projection, stamp(selected.columns)].join(',') + ' FROM main.' +
      quote(selected.metadata.target.table) + ' WHERE ' + where + ' LIMIT 2', parameters, 2, control, undefined, recordLimits.recordBytes);
    if (matches.length !== 1 || matches[0][columns.length] !== sqliteIdentity.stamp) throw Error('SQLite 原记录已变化或移除，请重新搜索');
    const fields = columns.map((column, index) => {
      const rawValue = matches[0][index];
      if (rawValue === null) return { ...column, binary: false, value: null, characters: null, truncated: false };
      const { text, characters, truncated, binary } = decodePreview(rawValue);
      return { ...column, binary: !!binary, value: binary ? { type: 'binary' as const, base64: text } : text, characters, truncated };
    });
    const result: DataSearchRecord = { target: selected.metadata.target, fields, searchedAt: entry.searchedAt, readAt: new Date().toISOString(), timeZone: '+00:00', readOnly: true };
    if (Buffer.byteLength(JSON.stringify(result)) > recordLimits.recordBytes) throw Error('SQLite 定位记录超过 1 MiB');
    return result;
  });
}
