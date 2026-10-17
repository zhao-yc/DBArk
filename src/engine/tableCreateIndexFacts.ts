import { createHash } from 'node:crypto';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { assertTableCreatePrefixFacts } from './tableCreateIndexPlan';
import type { TableCreatePrefixFacts } from '../shared/tableCreate';
/** 仅规范化可信目录正整数；拒绝空白、前导零、指数、尾随字符及精度丢失。 */
export function tableCreateMetadataInteger(value: unknown): number {
  if (typeof value !== 'number' && (typeof value !== 'string' || value.length > 16 || !/^[1-9]\d*$/.test(value))) throw Error('新表目录整数格式不可信');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw Error('新表目录整数超出安全范围');
  return result;
}
/** 只读实际服务器及完整MAXLEN目录；不查询尚不存在的新表，不猜默认能力。 */
export async function readTableCreateIndexFacts(context: StructureTaskContext): Promise<TableCreatePrefixFacts> {
  const { dialect, version } = context.managed.status;
  if (dialect !== 'mysql' || typeof version !== 'string' || /\s/.test(version) || !/^8\.4\.11(?:[-+][^\s]+)?$/.test(version)) throw Error('新表前缀首片仅支持准确MySQL8.4.11');
  const rows = (await structureTaskQuery<Record<string, unknown>[]>(context, 'SELECT @@innodb_page_size AS pageSize,@@innodb_default_row_format AS defaultRowFormat')).rows;
  if (!Array.isArray(rows) || rows.length !== 1 || tableCreateMetadataInteger(rows[0].pageSize) !== 16384 || typeof rows[0].defaultRowFormat !== 'string' || rows[0].defaultRowFormat.toUpperCase() !== 'DYNAMIC') throw Error('实际页大小或默认行格式未证明为16KiB/DYNAMIC');
  const catalog = (await structureTaskQuery<{ name: string; maxBytes: unknown }[]>(context, 'SELECT CHARACTER_SET_NAME AS name,MAXLEN AS maxBytes FROM information_schema.CHARACTER_SETS ORDER BY CHARACTER_SET_NAME LIMIT 257')).rows;
  if (!Array.isArray(catalog) || !catalog.length || catalog.length > 256) throw Error('实际MAXLEN目录不完整或超出预算');
  const content = { dialect, serverVersion: version, pageSize: 16384, defaultRowFormat: 'DYNAMIC', charsets: catalog.map(row => ({ name: row.name, maxBytes: tableCreateMetadataInteger(row.maxBytes) })) } as const;
  const facts: TableCreatePrefixFacts = { ...content, digest: createHash('sha256').update(JSON.stringify(content)).digest('hex') };
  assertTableCreatePrefixFacts(facts); return facts;
}
