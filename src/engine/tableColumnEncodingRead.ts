import { createHash } from 'node:crypto';
import { readTableColumnAutoIncrementFacts, assertTableColumnAutoIncrementUnchanged, type TableColumnAutoIncrementFacts } from './tableColumnAutoIncrementRead';
import { readTableDefaultEncodingCatalog } from './tableDefaultEncodingCatalog';
import { indexReferenceNames, type IndexReferenceNames } from './tableIndexRead';
import { structureTaskQuery, type StructureDefinitionRead, type StructureTaskContext } from './structureDefinition';
import type { TableColumnPatchTarget } from '../shared/tableColumnPatches';
import { columnEncodingMessages as text } from '../shared/tableColumnEncoding';
import { types } from 'node:util';

export interface ColumnEncodingFacts { base: StructureDefinitionRead; core: TableColumnAutoIncrementFacts; catalog: Awaited<ReturnType<typeof readTableDefaultEncodingCatalog>>; maxlen: [string, number][]; digest: string; bytes: number; }
export type ColumnEncodingReadResult = { kind: 'ready'; value: ColumnEncodingFacts } | { kind: 'unavailable'; reason: string };
/** 复用真实完整COLUMNS/IndexRead/原生实体/权限证明；专用途只追加目录，不伪造旧列或访问权限。 */
export async function readColumnEncodingFacts(context: StructureTaskContext, target: TableColumnPatchTarget, base: StructureDefinitionRead, refs: IndexReferenceNames, prepared?: TableColumnAutoIncrementFacts): Promise<ColumnEncodingReadResult> {
  try {
    const first = prepared ? { kind: 'ready' as const, value: prepared } : await readTableColumnAutoIncrementFacts(context, target, base, refs);
    if (first.kind !== 'ready') return { kind: 'unavailable', reason: text.unavailable };
    const catalog = await readTableDefaultEncodingCatalog(context);
    const raw = (await structureTaskQuery<{ charset: string; maxlen: number | string }[]>(context, 'SELECT CHARACTER_SET_NAME AS charset, MAXLEN AS maxlen FROM information_schema.CHARACTER_SETS ORDER BY BINARY CHARACTER_SET_NAME LIMIT 257')).rows;
    if (types.isProxy(raw) || !Array.isArray(raw) || raw.length > 256 || !raw.length || Reflect.ownKeys(raw).length!==raw.length+1) throw Error('字符集MAXLEN目录无效或超预算');
    const maxlen: [string, number][] = [], seen = new Set<string>();
    for (let index=0;index<raw.length;index++) {
      const item=Object.getOwnPropertyDescriptor(raw,String(index)),row:unknown=item?.value;
      if(!item||!Object.hasOwn(item,'value')||!row||typeof row!=='object'||types.isProxy(row)||Reflect.ownKeys(row).length!==2)throw Error('字符集MAXLEN目录行不是自有标量');
      const name=Object.getOwnPropertyDescriptor(row,'charset'),width=Object.getOwnPropertyDescriptor(row,'maxlen'),charset:unknown=name?.value,value:unknown=width?.value;
      if(!name?.enumerable||!width?.enumerable||!Object.hasOwn(name,'value')||!Object.hasOwn(width,'value')||typeof charset!=='string'||!/^[A-Za-z0-9_]{1,64}$/.test(charset)||seen.has(charset)||!(typeof value==='number'&&Number.isSafeInteger(value)||typeof value==='string'&&/^[1-9]\d?$/.test(value))||Number(value)<1||Number(value)>16)throw Error('字符集MAXLEN目录不完整');
      seen.add(charset); maxlen.push([charset, Number(value)]);
    }
    if (catalog.candidates.some(pair => !seen.has(pair.charset))) throw Error('排序规则和字符集MAXLEN目录不能互相覆盖');
    const final = await readTableColumnAutoIncrementFacts(context, target, base, indexReferenceNames(first.value.indexes));
    if (final.kind !== 'ready') throw Error(text.unavailable);
    assertTableColumnAutoIncrementUnchanged(first.value, final.value);
    const again = await readTableDefaultEncodingCatalog(context);
    if (catalog.digest !== again.digest) throw Error('列编码候选目录在读取期间变化');
    const digest = createHash('sha256').update(JSON.stringify([first.value.physical, first.value.columns, first.value.indexes.catalogDigest, first.value.indexes.dependencyDigest, catalog.digest, maxlen])).digest('hex');
    const bytes = first.value.bytes + catalog.bytes + Buffer.byteLength(JSON.stringify([base, maxlen])) + Buffer.byteLength(base.source)*2 + 8192;
    if (bytes > 12 * 1024 * 1024) throw Error('列编码完整事实超过预算');
    context.checkCancelled(); return { kind: 'ready', value: { base, core: first.value, catalog, maxlen, digest, bytes } };
  } catch (error) {
    context.checkCancelled(); if (context.managed.broken || context.managed.signal?.aborted) throw error;
    return { kind: 'unavailable', reason: text.unavailable };
  }
}
/** 新短会话在预览和发送前必须仍是原实体、目录及候选；不把聚合预检当数据锁。 */
export function assertColumnEncodingUnchanged(before: ColumnEncodingFacts, after: ColumnEncodingFacts): void {
  assertTableColumnAutoIncrementUnchanged(before.core, after.core);
  if (before.digest !== after.digest || before.base.source !== after.base.source || before.base.originalMode !== after.base.originalMode || before.base.normalizedMode !== after.base.normalizedMode) throw Error('列编码实体、完整目录、模式或候选已变化，未发送DDL');
}
