import { z } from 'zod';
import type { SqlSnippet } from './contracts';
import { SNIPPET_LIMITS, snippetSchema } from './snippets';

export const snippetTransferLimits = { bytes: 4 * 1024 * 1024, lifetime: 10 * 60 * 1000, sessions: 32 } as const;
export const snippetTransferZh = {
  export: '导出片段 JSON', import: '导入片段 JSON', preview: '片段导入差异预览', confirm: '确认导入所选更改', cancel: '取消传输', closePreview: '取消本次导入',
  invalid: '片段文件格式无效：仅支持 DBArk-snippets 版本 1、最多500条、4 MiB UTF-8 JSON，禁止未知字段和重复ID。',
  reserved: 'builtin- 开头的ID保留给内置模板，不能导入或覆盖；请先复制为用户片段。',
  stale: '片段库、窗口或传输已变化，请重新选择文件预览；未自动重试。',
  busy: '已有片段传输尚未结束，请等待或取消。', empty: '当前没有可导出的用户片段。',
  sameName: '存在同名片段，将保留为不同ID的独立用户片段，不自动覆盖。', builtinName: '名称与内置模板相同；只保存用户副本，不修改内置模板。',
  add: '新增', replace: '替换同ID片段', same: '内容相同', skip: '跳过', previous: '本地原内容', incoming: '文件内容',
  hint: '只交换用户片段，不包含连接配置、凭据字段或历史。预览不保存；同名不会自动匹配，替换仅针对同ID，必须显式确认。',
  committing: '文件发布已开始，当前不能取消；请等待结果，不会自动重试。', exported: (n: number) => `已导出 ${n} 条用户片段。`,
  applied: (a: number, r: number, s: number) => `导入完成：新增 ${a} 条、替换 ${r} 条、跳过 ${s} 条。`,
};
export type SnippetTransferAction = 'add' | 'replace' | 'skip';
export interface SnippetTransferEntry { snippet: SqlSnippet; previous?: SqlSnippet; status: 'add' | 'replace' | 'same'; warnings: string[]; }
export interface SnippetTransferPreview { previewId: string; expiresAt: number; entries: SnippetTransferEntry[]; }
export interface SnippetTransferDecision { id: string; action: SnippetTransferAction; }
export interface SnippetTransferResult { items: SqlSnippet[]; added: number; replaced: number; skipped: number; }
const scope = z.string().uuid();
export const snippetTransferSchemas = {
  'snippets.transferOpen': z.object({}).strict(),
  'snippets.transferPreview': z.object({ scopeId: scope }).strict(),
  'snippets.transferExport': z.object({ scopeId: scope }).strict(),
  'snippets.transferCancel': z.object({ scopeId: scope, close: z.boolean().optional() }).strict(),
  'snippets.transferApply': z.object({ scopeId: scope, previewId: scope, decisions: z.array(z.object({ id: z.string().min(1).max(200), action: z.enum(['add', 'replace', 'skip']) }).strict()).max(SNIPPET_LIMITS.count) }).strict(),
};

/** 批次只做一次线性总预算计量，SQL逐字保存，不trim、不插值或归一化行尾。 */
export function validateSnippetCollection(input: unknown): SqlSnippet[] {
  const parsed = z.array(snippetSchema).max(SNIPPET_LIMITS.count).safeParse(input);
  if (!parsed.success || new Set(parsed.data.map(s => s.id)).size !== parsed.data.length) throw Error(snippetTransferZh.invalid);
  if (parsed.data.some(s => s.id.startsWith('builtin-'))) throw Error(snippetTransferZh.reserved);
  if (parsed.data.reduce((n, s) => n + new TextEncoder().encode(s.sql).length, 0) > SNIPPET_LIMITS.totalSql) throw Error(snippetTransferZh.invalid);
  return parsed.data;
}

/** 公开版本化白名单；外部未知字段不回显，BOM仅允许出现在整个UTF-8文件开头。 */
export function decodeSnippetTransfer(bytes: Uint8Array): SqlSnippet[] {
  if (!bytes.length || bytes.length > snippetTransferLimits.bytes) throw Error(snippetTransferZh.invalid);
  try {
    const value = z.object({ format: z.literal('DBArk-snippets'), version: z.literal(1), snippets: z.unknown() }).strict().parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    return validateSnippetCollection(value.snippets);
  } catch { throw Error(snippetTransferZh.invalid); }
}
/** JSON外层固定LF和UTF-8，SQL中的CRLF/LF/引号和Unicode则由JSON无损转义。 */
export function encodeSnippetTransfer(items: SqlSnippet[]): string {
  const text = JSON.stringify({ format: 'DBArk-snippets', version: 1, snippets: validateSnippetCollection(items) }, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > snippetTransferLimits.bytes) throw Error(snippetTransferZh.invalid);
  return text;
}
/** ID才是替换身份；重复名称只提示，不建立名称到目标ID的隐式配对。 */
export function previewSnippetTransfer(existing: SqlSnippet[], incoming: SqlSnippet[]): SnippetTransferEntry[] {
  const builtinNames = ['按条件读取列', '分组统计', '查看查询执行计划'];
  const same = (a: SqlSnippet, b: SqlSnippet) => ['name', 'group', 'description', 'sql'].every(key => a[key as keyof SqlSnippet] === b[key as keyof SqlSnippet]);
  return incoming.map(snippet => {
    const previous = existing.find(s => s.id === snippet.id), sameName = existing.some(s => s.name === snippet.name && s.id !== snippet.id) || incoming.some(s => s.name === snippet.name && s.id !== snippet.id);
    return { snippet, ...(previous ? { previous } : {}), status: previous ? same(previous, snippet) ? 'same' : 'replace' : 'add', warnings: [...(sameName ? [snippetTransferZh.sameName] : []), ...(builtinNames.includes(snippet.name) ? [snippetTransferZh.builtinName] : [])] };
  });
}
