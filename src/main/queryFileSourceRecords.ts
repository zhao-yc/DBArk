import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { queryFileSourceRefSchema, type QueryFileSourceView } from '../shared/queryFileSources';

/** 私有表完整校验；路径及物理身份不进入settings、连接导出或renderer请求。 */
export const privateQueryFileSourceSchema = z.object({
  version: z.literal(1), tabId: z.string().min(1).max(200), connectionId: z.string().min(1).max(200), ref: queryFileSourceRefSchema,
  path: z.string().min(1).max(32768).refine(value => !value.includes('\0') && isAbsolute(value)),
  identity: z.object({ dev: z.string().regex(/^\d+$/), ino: z.string().regex(/^[1-9]\d*$/), size: z.number().int().min(0).max(20 * 1024 * 1024), mtime: z.string().regex(/^\d+$/), ctime: z.string().regex(/^\d+$/) }).strict(),
  fileDigest: z.string().regex(/^[a-f0-9]{64}$/), savedSqlDigest: z.string().regex(/^[a-f0-9]{64}$/),
  encoding: z.enum(['utf8', 'utf16le', 'gb18030']), bom: z.enum(['none', 'utf8', 'utf16le']), eol: z.enum(['none', 'lf', 'crlf', 'cr', 'mixed'])
}).strict().refine(value => value.bom === 'none' || value.bom === value.encoding, '来源BOM和编码不匹配');
export type PrivateQueryFileSource = z.infer<typeof privateQueryFileSourceSchema>;

/** 只投影展示字段；物理身份、路径授权和原始文件摘要留在Main。 */
export function queryFileSourceView(source: PrivateQueryFileSource): QueryFileSourceView {
  return { ref: { ...source.ref }, name: source.path.split(/[\\/]/).at(-1)!, displayPath: source.path, encoding: source.encoding, bom: source.bom, eol: source.eol, savedSqlDigest: source.savedSqlDigest };
}
