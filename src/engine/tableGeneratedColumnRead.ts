import { structureTaskQuery, readStructureDefinition, assertStructureDefinitionUnchanged, structureDocumentOf, sameStructureFragment, type StructureTaskContext, type StructureDefinitionRead } from './structureDefinition';
import { readGeneratedColumnDefinition, sameGeneratedColumnExpression, isGeneratedColumnReference } from './tableGeneratedColumn';
import { columnOnUpdateVersionSupported, type TableColumnPatchTarget } from '../shared/tableColumnPatches';
import { types } from 'node:util';

interface GeneratedCatalogColumn { name: string; ordinal: number; typeSql: string; dataType: string; nullable: string; defaultValue: string | null; extra: string; generationExpression: string; charset: string | null; collation: string | null; comment: string; }
interface GeneratedPhysical { tableId: string; serverIdentity: string; target: TableColumnPatchTarget; version: string; os: string; lowerNames: 0; catalog: string; }
export interface GeneratedColumnRead { physical: GeneratedPhysical; columns: GeneratedCatalogColumn[]; references: string[]; bytes: number; }
export type GeneratedColumnReadResult = { kind: 'ready'; value: GeneratedColumnRead } | { kind: 'unavailable'; reason: string };
export const generatedColumnReadLimits = { columns: 4096, catalogBytes: 2 * 1024 * 1024, identityBytes: 64 * 1024, totalBytes: 5 * 1024 * 1024 } as const;
const literal = (value: string): string => `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;

/** 每次真实回调以后核原取消与连接终态；不能把中断降级成普通只读能力。 */
function active(context: StructureTaskContext): void {
  context.checkCancelled();
  if (context.managed.signal?.aborted) throw context.managed.signal.reason ?? Error('生成列目录读取已取消');
  if (context.managed.broken) throw Error('生成列目录连接已断开');
}

/** 只复制固定标量字段，先计实际UTF8及转义字节，不序列化目录中的未知对象。 */
function rows(value: unknown, keys: readonly string[], count: number, budget: number): Record<string, string | number | null>[] {
  if (types.isProxy(value) || !Array.isArray(value) || value.length > count || Reflect.ownKeys(value).length !== value.length + 1) throw Error('生成列目录数量或结构无效');
  const result: Record<string, string | number | null>[] = []; let bytes = 2;
  for (let index = 0; index < value.length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !Object.hasOwn(item, 'value') || !item.value || typeof item.value !== 'object' || types.isProxy(item.value) || Reflect.ownKeys(item.value).length !== keys.length) throw Error('生成列目录行结构无效');
    const copy: Record<string, string | number | null> = {};
    for (const key of keys) {
      const field = Object.getOwnPropertyDescriptor(item.value, key), scalar: unknown = field?.value;
      if (!field?.enumerable || !Object.hasOwn(field, 'value') || scalar !== null && typeof scalar !== 'string' && !(typeof scalar === 'number' && Number.isSafeInteger(scalar))) throw Error('生成列目录字段结构无效');
      bytes += Buffer.byteLength(key) + (typeof scalar === 'string' ? Buffer.byteLength(scalar) : 24) + 8;
      if (bytes > budget) throw Error('生成列目录超过独立字节预算');
      copy[key] = scalar as string | number | null;
    }
    result.push(copy);
  }
  if (Buffer.byteLength(JSON.stringify(result)) > budget) throw Error('生成列目录转义后超过字节预算');
  return result;
}

/** 沿已验证Linux/ASCII/大小写映射读取真实原生TABLE_ID，不用定义摘要代替物理身份。 */
async function physical(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead): Promise<GeneratedPhysical> {
  active(context);
  const mysql = base.context.dialect === 'mysql', version = base.serverVersion.replace(/^5\.5\.5-/, ''), catalog = mysql && /^8\.(?:0|4)\./.test(version) ? 'INNODB_TABLES' : 'INNODB_SYS_TABLES';
  if (!columnOnUpdateVersionSupported(base.context.dialect, base.serverVersion) || context.managed.status.version !== base.serverVersion || context.managed.status.dialect !== base.context.dialect || ![target.database, target.table].every(value => /^[A-Za-z0-9_]{1,64}$/.test(value))) throw Error('生成列首批只开放已验证版本的ASCII命名InnoDB表');
  const query = async (sql: string, keys: readonly string[]) => { const result = await structureTaskQuery<unknown>(context, sql); active(context); return rows(result.rows, keys, 2, generatedColumnReadLimits.identityBytes); };
  const server = await query('SELECT VERSION() AS version, @@version_compile_os AS os, @@lower_case_table_names AS lowerNames LIMIT 2', ['version', 'os', 'lowerNames']);
  if (server.length !== 1 || server[0].version !== base.serverVersion || typeof server[0].os !== 'string' || !['linux', 'debian-linux-gnu'].includes(server[0].os.toLowerCase()) || ![0, '0'].includes(server[0].lowerNames as number)) throw Error('生成列服务器版本或名称映射不能证明');
  const where = `CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY)`;
  const tables = await query(`SELECT TABLE_SCHEMA AS databaseName, TABLE_NAME AS tableName, TABLE_TYPE AS kind, ENGINE AS engine FROM information_schema.TABLES WHERE ${where} LIMIT 2`, ['databaseName', 'tableName', 'kind', 'engine']);
  if (tables.length !== 1 || tables[0].databaseName !== target.database || tables[0].tableName !== target.table || tables[0].kind !== 'BASE TABLE' || tables[0].engine !== 'InnoDB') throw Error('生成列实际基本表身份不能唯一证明');
  const partitions = await query(`SELECT PARTITION_NAME AS name FROM information_schema.PARTITIONS WHERE ${where} LIMIT 2`, ['name']);
  if (partitions.length !== 1 || partitions[0].name !== null) throw Error('生成列首批不开放分区表');
  const nativeName = target.database + '/' + target.table, identities = await query(`SELECT CAST(TABLE_ID AS CHAR) AS id, NAME AS name FROM information_schema.${catalog} WHERE CAST(NAME AS BINARY)=CAST(${literal(nativeName)} AS BINARY) LIMIT 2`, ['id', 'name']);
  const id = identities[0]?.id;
  if (identities.length !== 1 || identities[0].name !== nativeName || typeof id !== 'string' || !/^[1-9]\d{0,19}$/.test(id) || id.length === 20 && id > '18446744073709551615') throw Error('生成列原生表编号不能唯一证明');
  return { tableId: id, target: { ...target }, serverIdentity: base.identity, version: base.serverVersion, os: server[0].os, lowerNames: 0, catalog };
}

/** 目录必须覆盖全部原字段及精确位次；SHOW与GENERATION_EXPRESSION/EXTRA相互作证。 */
async function catalog(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead): Promise<GeneratedCatalogColumn[]> {
  const where = `CAST(TABLE_SCHEMA AS BINARY)=CAST(${literal(target.database)} AS BINARY) AND CAST(TABLE_NAME AS BINARY)=CAST(${literal(target.table)} AS BINARY)`;
  const value = await structureTaskQuery<unknown>(context, `SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS ordinal, COLUMN_TYPE AS typeSql, DATA_TYPE AS dataType, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, GENERATION_EXPRESSION AS generationExpression, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation, COLUMN_COMMENT AS comment FROM information_schema.COLUMNS WHERE ${where} ORDER BY ORDINAL_POSITION LIMIT 4097`); active(context);
  const raw = rows(value.rows, ['name', 'ordinal', 'typeSql', 'dataType', 'nullable', 'defaultValue', 'extra', 'generationExpression', 'charset', 'collation', 'comment'], generatedColumnReadLimits.columns, generatedColumnReadLimits.catalogBytes), document = structureDocumentOf(base), extras = new Map(base.columnExtras ?? []);
  if (raw.length !== document.columns.length) throw Error('生成列完整字段目录数量与定义不一致');
  return raw.map((item, index) => {
    const column = document.columns[index];
    if (item.name !== column.name || Number(item.ordinal) !== index + 1 || !['YES', 'NO'].includes(item.nullable as string) || (item.nullable === 'YES') !== column.nullable || typeof item.typeSql !== 'string' || !sameStructureFragment(item.typeSql, column.type.raw, document.context) || typeof item.dataType !== 'string' || typeof item.extra !== 'string' || typeof item.comment !== 'string' || item.comment !== (column.comment ?? '') || item.defaultValue !== null && typeof item.defaultValue !== 'string' || item.generationExpression !== null && typeof item.generationExpression !== 'string') throw Error('生成列字段完整目录与原定义不一致');
    const encoding = base.encodings[index];
    if (!encoding || encoding.name !== column.name || item.charset !== encoding.charset || item.collation !== encoding.collation || extras.get(column.name) !== item.extra) throw Error('生成列有效编码或EXTRA目录与原定义读取不一致');
    const typeFamily = /^[A-Za-z]+/.exec(column.type.raw.trim())?.[0].toUpperCase(), aliases: Record<string, string> = { INTEGER: 'INT', NUMERIC: 'DECIMAL' };
    if (!typeFamily || (aliases[typeFamily] ?? typeFamily) !== item.dataType.toUpperCase()) throw Error('生成列字段类型目录与原定义矛盾');
    const generated = readGeneratedColumnDefinition(document, column.name), expression = item.generationExpression ?? '', rawExtra = item.extra.trim();
    if (column.attributes.some(attribute => attribute.kind === 'generated') && !generated) throw Error('原生成列表达式不属于可证明的受控语法');
    if (generated) {
      // 生成属性不能剥掉DEFAULT_GENERATED或其它尾缀再洗成合法；Maria原目录NULL不等于带引号的文本'NULL'。
      const storage = /^(VIRTUAL|STORED|PERSISTENT)\s+GENERATED$/i.exec(rawExtra)?.[1].toUpperCase(), sqlNull = item.defaultValue === null || document.context.dialect === 'mariadb' && item.defaultValue === 'NULL';
      if (!storage || (storage === 'PERSISTENT' ? 'STORED' : storage) !== generated.storage || typeof expression !== 'string' || !expression || !sqlNull || item.nullable !== 'YES' || !sameGeneratedColumnExpression(document, generated.expression, expression, index)) throw Error('生成列表达式或存储方式目录与SHOW定义不一致');
    } else {
      const markers = rawExtra.match(/\bDEFAULT_GENERATED\b/ig) ?? [];
      if (markers.length && (markers.length !== 1 || document.context.dialect !== 'mysql' || column.default.kind !== 'expression')) throw Error('普通列DEFAULT_GENERATED目录与SHOW默认表达式矛盾');
      const extra = rawExtra.replace(/\bDEFAULT_GENERATED\b/ig, '').trim();
      const expectedExtra = column.attributes.some(attribute => attribute.kind === 'auto-increment') ? 'auto_increment' : column.attributes.find(attribute => attribute.kind === 'on-update')?.raw ?? '';
      if (expression !== '' || /\bGENERATED\b/i.test(extra) || !sameStructureFragment(extra, expectedExtra, document.context)) throw Error('生成列目录与普通列定义矛盾');
    }
    return { ...item, ordinal: index + 1, generationExpression: expression } as GeneratedCatalogColumn;
  });
}

/** 附加事实失败只关闭新能力；取消、断线、主动中止保持原任务失败，不掩盖资源未知。 */
export async function readGeneratedColumnFacts(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead): Promise<GeneratedColumnReadResult> {
  try {
    const before = await physical(context, target, base), columns = await catalog(context, target, base), final = await readStructureDefinition(context, target, false);
    assertStructureDefinitionUnchanged({ ...base, originalMode: base.normalizedMode }, final);
    if (JSON.stringify(base.columnExtras) !== JSON.stringify(final.columnExtras) || base.serverVersion !== final.serverVersion) throw Error('生成列读取期间完整目录或版本变化');
    const after = await physical(context, target, final);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('生成列读取期间物理身份变化');
    const document = structureDocumentOf(base), references = document.columns.filter(column => isGeneratedColumnReference(document, column.name)).map(column => column.name), value = { physical: before, columns, references }, bytes = Buffer.byteLength(JSON.stringify(value));
    if (bytes > generatedColumnReadLimits.totalBytes) throw Error('生成列私有证据超过独立总预算');
    active(context); return { kind: 'ready', value: { ...value, bytes } };
  } catch (error) {
    active(context);
    // 不返回driver原错误，避免目录权限信息或表达式片段进入任务/历史。
    return { kind: 'unavailable', reason: '生成列目录、版本或物理身份未能完整核实；普通字段编辑仍可继续，请重新读取后再试' };
  }
}

/** 发送前严格核原生编号和全列目录；用于get→preview→apply，绝不用于DDL后要求同ID。 */
export function assertGeneratedColumnUnchanged(before: GeneratedColumnRead, after: GeneratedColumnRead): void {
  if (JSON.stringify(before.physical) !== JSON.stringify(after.physical) || JSON.stringify(before.columns) !== JSON.stringify(after.columns) || JSON.stringify(before.references) !== JSON.stringify(after.references)) throw Error('生成列物理身份或完整目录已变化；未发送DDL');
}

/** 仅末尾新增允许ID重建，旧列目录逐项不变及服务器/映射一致仍必须成立。 */
export function verifyGeneratedColumnCatalog(before: GeneratedColumnRead, after: GeneratedColumnRead): boolean {
  const physicalWithoutId = ({ tableId: _tableId, ...value }: GeneratedPhysical) => value;
  return JSON.stringify(physicalWithoutId(before.physical)) === JSON.stringify(physicalWithoutId(after.physical)) && after.columns.length === before.columns.length + 1 && JSON.stringify(after.columns.slice(0, before.columns.length)) === JSON.stringify(before.columns);
}
