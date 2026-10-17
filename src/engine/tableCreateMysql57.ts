import type { TableCreateDesign } from '../shared/tableCreate';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { definitionOmittingSqlModes } from '../shared/tableColumnPatches';

export const mysql57CreateMessages = {
  facts: '准确MySQL5.7.44新建表能力、会话变量或实际目录未完整证明，当前只读；未发送DDL。',
  engine: '本片5.7.44新建表仅证明实际可用的InnoDB及目录中的字符集，其他组合当前只读。',
  timestamp: '5.7.44当前未启用显式TIMESTAMP默认行为，时间列可能被服务器隐式改写；本片只读，不自动SET或改写设计。',
  defaults: 'MySQL5.7.44不接受这些类型的非空默认值；本片只读，不将文字量改成表达式。',
} as const;
export interface Mysql57CreateCapabilities { version: string; explicitTimestamp: boolean; engineSupport: 'YES' | 'DEFAULT'; charsets: string[]; }
export const mysql57CreateFactSql = 'SELECT @@version AS version,@@explicit_defaults_for_timestamp AS explicitTimestamp,@@innodb_strict_mode AS innodbStrict';
/** 只接受准确补丁及无空白发行后缀；方言来自实际连接，版本字符串不能把Maria伪装成MySQL。 */
export function isExactMysql57CreateVersion(version: string): boolean { return /^5\.7\.44(?:[-+][^\s]+)?$/.test(version) && !/maria|\s/i.test(version); }

/** 每个独立会话实际读取5.7已有变量及有界目录，不探测8.x专属变量，不吞错补造能力。 */
export async function readMysql57CreateCapabilities(context: StructureTaskContext): Promise<Mysql57CreateCapabilities> {
  if (context.managed.status.dialect !== 'mysql' || !isExactMysql57CreateVersion(context.managed.status.version)) throw Error(mysql57CreateMessages.facts);
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, mysql57CreateFactSql)).rows, row = rows?.[0];
  if (rows?.length !== 1 || !row || typeof row.version !== 'string' || row.version !== context.managed.status.version || !isExactMysql57CreateVersion(row.version) || ![0, 1, '0', '1'].includes(row.explicitTimestamp as number) || ![1, '1'].includes(row.innodbStrict as number)) throw Error(mysql57CreateMessages.facts);
  const engines = (await structureTaskQuery<{ engine: string; support: string }[]>(context, "SELECT ENGINE AS engine,SUPPORT AS support FROM information_schema.ENGINES WHERE ENGINE='InnoDB' LIMIT 2")).rows;
  if (engines?.length !== 1 || engines[0].engine !== 'InnoDB' || !['YES', 'DEFAULT'].includes(engines[0].support)) throw Error(mysql57CreateMessages.facts);
  const charsets = (await structureTaskQuery<{ charset: string }[]>(context, 'SELECT CHARACTER_SET_NAME AS charset FROM information_schema.CHARACTER_SETS ORDER BY BINARY CHARACTER_SET_NAME LIMIT 257')).rows;
  if (!Array.isArray(charsets) || !charsets.length || charsets.length > 256 || charsets.some(row => !row || typeof row.charset !== 'string' || !/^[A-Za-z0-9_]{1,64}$/.test(row.charset)) || new Set(charsets.map(row => row.charset)).size !== charsets.length) throw Error(mysql57CreateMessages.facts);
  return { version: row.version, explicitTimestamp: row.explicitTimestamp === 1 || row.explicitTimestamp === '1', engineSupport: engines[0].support as 'YES' | 'DEFAULT', charsets: charsets.map(row => row.charset) };
}

/** 只增加已证明普通设计的5.7边界；FK、列类型及表达式仍交给原生成器和原完整后核，不扩大能力。 */
export function assertMysql57CreateDesign(design: TableCreateDesign, capabilities: Mysql57CreateCapabilities, mode: string): void {
  if (mode.split(',').some(value => (definitionOmittingSqlModes as readonly string[]).includes(value.toUpperCase()))) throw Error(mysql57CreateMessages.facts);
  if (design.engine.toUpperCase() !== 'INNODB' || !capabilities.charsets.includes(design.charset)) throw Error(mysql57CreateMessages.engine);
  if (!capabilities.explicitTimestamp && design.columns.some(column => /^TIMESTAMP\b/i.test(column.type.trim()))) throw Error(mysql57CreateMessages.timestamp);
  if (design.columns.some(column => /^(?:(?:TINY|MEDIUM|LONG)?(?:TEXT|BLOB)|JSON|GEOMETRY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\b/i.test(column.type.trim()) && column.defaultValue !== undefined && column.defaultValue !== null)) throw Error(mysql57CreateMessages.defaults);
}
