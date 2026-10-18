import { z } from 'zod';
import { isAbsolute, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { queryFileSourceLimits, type QueryRecentFileView } from '../shared/queryFileSources';
import type { PrivateQueryFileSource } from './queryFileSourceRecords';

/** 私有缓存不含SQL、连接或凭据；renderer永远不能提交这里的路径。 */
export const privateQueryRecentFilesSchema = z.array(z.object({ id: z.string().uuid(), path: z.string().min(1).max(32768).refine(value => isAbsolute(value) && !value.includes('\0')), encoding: z.enum(['utf8', 'utf16le', 'gb18030']) }).strict()).max(queryFileSourceLimits.recents);
export type PrivateQueryRecentFile = z.infer<typeof privateQueryRecentFilesSchema>[number];
/** 路径使用原来源的canonical值；Windows按大小写不敏感去重，重复使用置顶而非增加条目。 */
export function rememberQueryFile(entries: PrivateQueryRecentFile[], source: Pick<PrivateQueryFileSource, 'path' | 'encoding'>): PrivateQueryRecentFile[] {
  const key = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
  const existing = entries.find(item => key(item.path) === key(source.path));
  return privateQueryRecentFilesSchema.parse([{ id: existing?.id ?? randomUUID(), path: source.path, encoding: source.encoding }, ...entries.filter(item => key(item.path) !== key(source.path))].slice(0, queryFileSourceLimits.recents));
}
/** 展示字段不授予文件权限，禁止把历史条目投影为连接配置或自动读取请求。 */
export function queryRecentFileView(item: PrivateQueryRecentFile): QueryRecentFileView { return { id: item.id, name: basename(item.path), displayPath: item.path, encoding: item.encoding }; }
