import { z } from 'zod';
import type { TableCreateDraft, TableCreateEncodingCatalog } from './tableCreate';
import { sameTableEncodingPair, type TableEncodingPair } from './tableDefaultEncoding';

export const tableCreateColumnEncodingSchema = z.object({ charset: z.string().regex(/^[A-Za-z0-9_]{1,64}$/), collation: z.string().regex(/^[A-Za-z0-9_]{1,255}$/) }).strict();
export interface TableCreateColumnEncodingPlan { catalogDigest: string; selections: { ordinal: number; name: string; charset: string; collation: string }[]; }
type Column = { type: string; generated?: unknown; collation?: TableEncodingPair };
export const tableCreateColumnEncodingMessages = {
  invalid: '列级编码必须是完整字符集与排序规则配对；仅普通CHAR、VARCHAR、TEXT、ENUM、SET字段可指定。',
  catalog: '列级编码必须选择本次完整实际目录中的准确配对，请重新读取编码目录。',
  legacy: '列级编码必须使用新建表专属计划，不能经旧入口静默丢弃。',
} as const;
/** 与原类型生成器保持同一完整语法边界；ENUM文字量不作为SQL关键字解析。 */
export function tableCreateColumnEncodingAllowed(column: Pick<Column, 'type' | 'generated'>): boolean {
  if (Object.hasOwn(column, 'generated') || typeof column.type !== 'string') return false;
  const type = column.type.trim();
  return /^(?:CHAR|VARCHAR)\(\d{1,5}\)$/i.test(type) || /^(?:TINY|MEDIUM|LONG)?TEXT$/i.test(type) || /^(?:ENUM|SET)\(\s*'(?:[^'\\]|'')*'(?:\s*,\s*'(?:[^'\\]|'')*')*\s*\)$/i.test(type);
}
/** 省略表示继承；自有undefined不能被当作省略，生成列也不能借此夹带属性。 */
export function assertTableCreateColumnEncoding(column: Column): void {
  if (!Object.hasOwn(column, 'collation')) return;
  if (!tableCreateColumnEncodingAllowed(column) || !tableCreateColumnEncodingSchema.safeParse(column.collation).success) throw Error(tableCreateColumnEncodingMessages.invalid);
}
/** 共享检查只证明草稿语义，不把草稿伪装成实际列目录。 */
export function assertTableCreateColumnEncodings(design: Pick<TableCreateDraft, 'columns'>): void { for (const column of design.columns) assertTableCreateColumnEncoding(column); }
/** 自有键触发专属路径，包含显式无效值。 */
export function tableCreateHasColumnEncoding(design: Pick<TableCreateDraft, 'columns'>): boolean { return design.columns.some(column => Object.hasOwn(column, 'collation')); }
/** 每列独立选择，未指定列始终继承表配对。 */
export function effectiveTableCreateColumnEncoding(column: Column, tablePair: TableEncodingPair): TableEncodingPair { assertTableCreateColumnEncoding(column); return column.collation ?? tablePair; }
/** 只保留真实目录中精确匹配的有序选择，摘要由服务端快照提供。 */
export function planTableCreateColumnEncodings(design: Pick<TableCreateDraft, 'columns'>, catalog: TableCreateEncodingCatalog | undefined): TableCreateColumnEncodingPlan {
  assertTableCreateColumnEncodings(design);
  if (!catalog || !catalog.digest || !/^[a-f0-9]{64}$/.test(catalog.digest) || catalog.reasons.length || catalog.candidates.length > 8192 || new TextEncoder().encode(JSON.stringify(catalog)).byteLength > 2 * 1024 * 1024) throw Error(tableCreateColumnEncodingMessages.catalog);
  const selections = design.columns.flatMap((column, ordinal) => {
    if (!Object.hasOwn(column, 'collation')) return [];
    const pair = tableCreateColumnEncodingSchema.parse(column.collation);
    if (!catalog.candidates.some(candidate => sameTableEncodingPair(candidate, pair))) throw Error(tableCreateColumnEncodingMessages.catalog);
    return [{ ordinal, name: column.name, ...pair }];
  });
  return { catalogDigest: catalog.digest, selections };
}
