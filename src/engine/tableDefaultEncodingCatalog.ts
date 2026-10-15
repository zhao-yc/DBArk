import { createHash } from 'node:crypto';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';
import { tableDefaultEncodingLimits as limits, validateTableEncodingPair, type TableEncodingPair } from '../shared/tableDefaultEncoding';

/** 目录只来自同一可取消结构会话；有界读取，不能把截断目录冒充完整候选。 */
export async function readTableDefaultEncodingCatalog(context: StructureTaskContext): Promise<{ candidates: TableEncodingPair[]; digest: string; warnings: string[]; bytes: number }> {
  const base = (await structureTaskQuery<{ charset: string; collation: string; compiled: string }[]>(context, `SELECT c.CHARACTER_SET_NAME AS charset,c.COLLATION_NAME AS collation,c.IS_COMPILED AS compiled FROM information_schema.COLLATIONS c JOIN information_schema.CHARACTER_SETS s ON BINARY s.CHARACTER_SET_NAME=BINARY c.CHARACTER_SET_NAME WHERE c.CHARACTER_SET_NAME IS NOT NULL ORDER BY BINARY c.COLLATION_NAME LIMIT ${limits.candidates + 1}`)).rows;
  if (!Array.isArray(base) || base.length > limits.candidates) throw new Error('排序规则目录超过候选预算，不能提供部分选择');
  const all = [...base], warnings: string[] = [];
  if (context.managed.status.dialect === 'mariadb') {
    const headers = (await structureTaskQuery<{ name: string }[]>(context, "SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='information_schema' AND TABLE_NAME='COLLATION_CHARACTER_SET_APPLICABILITY' LIMIT 65")).rows;
    if (!Array.isArray(headers) || headers.length > 64 || headers.some(row => typeof row.name !== 'string')) throw new Error('排序规则完整名称目录能力未知');
    const names = new Set(headers.map(row => row.name));
    if (names.has('FULL_COLLATION_NAME') && names.has('COLLATION_NAME') && names.has('CHARACTER_SET_NAME')) {
      const aliases = (await structureTaskQuery<{ charset: string; collation: string; compiled: string }[]>(context, `SELECT a.CHARACTER_SET_NAME AS charset,a.FULL_COLLATION_NAME AS collation,c.IS_COMPILED AS compiled FROM information_schema.COLLATION_CHARACTER_SET_APPLICABILITY a JOIN information_schema.COLLATIONS c ON BINARY c.COLLATION_NAME=BINARY a.COLLATION_NAME JOIN information_schema.CHARACTER_SETS s ON BINARY s.CHARACTER_SET_NAME=BINARY a.CHARACTER_SET_NAME ORDER BY BINARY a.FULL_COLLATION_NAME LIMIT ${limits.candidates + 1}`)).rows;
      if (!Array.isArray(aliases) || aliases.length > limits.candidates) throw new Error('完整排序规则目录超过候选预算');
      all.push(...aliases);
    } else warnings.push('服务器未提供完整排序规则名称映射，仅列出普通目录可唯一证明的配对；未知别名不自动补写。');
  }
  const bytes = Buffer.byteLength(JSON.stringify(all)); if (bytes > limits.catalogBytes) throw new Error('排序规则目录超过2 MiB预算');
  const pairs = new Map<string, TableEncodingPair>(), ambiguous = new Set<string>();
  for (const row of all) {
    if (!row || typeof row.compiled !== 'string' || !['YES', 'NO'].includes(row.compiled.toUpperCase())) throw new Error('排序规则编译能力无法确认');
    if (row.compiled.toUpperCase() !== 'YES') continue;
    const pair = validateTableEncodingPair(row), previous = pairs.get(pair.collation);
    if (previous && previous.charset !== pair.charset) ambiguous.add(pair.collation);
    else pairs.set(pair.collation, pair);
  }
  for (const name of ambiguous) pairs.delete(name);
  if (ambiguous.size) warnings.push('部分排序规则名称不能唯一对应字符集，已明确排除这些候选。');
  const candidates = [...pairs.values()].sort((a, b) => a.charset < b.charset ? -1 : a.charset > b.charset ? 1 : a.collation < b.collation ? -1 : a.collation > b.collation ? 1 : 0);
  if (!candidates.length || candidates.length > limits.candidates) throw new Error('没有可唯一证明的完整字符集与排序规则候选');
  return { candidates, digest: createHash('sha256').update(JSON.stringify([candidates, warnings])).digest('hex'), warnings, bytes };
}
