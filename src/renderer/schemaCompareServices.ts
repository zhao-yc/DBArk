import type { SchemaCompareServices } from './components/SchemaCompareDialog';
import { invoke } from './lib';

/** 使用正式 IPC 和查询文件令牌保存审查稿，渲染侧不接触路径或数据库凭据。 */
export const schemaCompareServices: SchemaCompareServices = {
  compare: input => invoke('schema.compare', input),
  cancel: taskId => invoke('query.cancel', { taskId }),
  preview: input => invoke('schema.comparePreview', input),
  release: snapshotId => invoke('schema.compareRelease', { snapshotId }),
  async save(sql) {
    const file = await invoke('files.choose', { purpose: 'export', format: 'sql', suggestedName: '结构比较预览.sql' });
    if (!file) return false;
    await invoke('files.writeQuery', { fileToken: file.token, encoding: 'utf8', sql });
    return true;
  },
};
