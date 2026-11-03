import JSZip from 'jszip';
import { savedQueryArchiveLimits, type SavedQueryExportSqlArchiveInput, type SavedQueryReadTextInput } from '../shared/savedQuerySearch';
import type { SavedQuery } from '../shared/contracts';
import { encodeQueryFile, writeQueryFileBytes } from './queryFiles';

/** 序号保留选取顺序并解决同名；文件名仅是单个可移植的路径段。 */
function sqlEntryName(name: string, index: number): string {
  const safe = name.replace(/[^\p{L}\p{M}\p{N}\p{S} _().-]|[<>:"/\\|?*]/gu, '_').trim().replace(/\.sql$/iu, '');
  const stem = [...safe].slice(0, 50).join('').replace(/^[ .]+|[ .]+$/g, '');
  return `${String(index + 1).padStart(3, '0')}-${stem || '查询'}.sql`;
}

/** 每条脚本无损编码，全部核对后才生成一个 ZIP，任何失败都不发布部分归档。 */
export async function writeSavedQueryArchive(path: string, items: SavedQueryExportSqlArchiveInput['items'], read: (item: SavedQueryReadTextInput) => SavedQuery, check: () => void): Promise<void> {
  const zip = new JSZip();
  let size = 0;
  for (const [index, item] of items.entries()) {
    check();
    const query = read(item);
    size += Buffer.byteLength(query.sql, 'utf8');
    if (size > savedQueryArchiveLimits.bytes) throw Error('所选 SQL 正文合计超过 32 MiB，未保存 ZIP');
    zip.file(sqlEntryName(query.name, index), encodeQueryFile(query.sql, 'utf8'));
  }
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
  await writeQueryFileBytes(path, archive, check);
}
