import { analyzeSqliteLocalReferences } from '../shared/sqliteLocalReferences';
import { sqliteCompletionLimits } from '../shared/sqliteCompletion';

/** SQLite引用线程仅接收有界文本位置；不接收MySQL模式、目录、IPC或执行内容。 */
self.onmessage = (event: MessageEvent<{ id: number; source: string; offset: number }>) => {
  const request = event.data;
  if (!request || Object.keys(request).sort().join(',') !== 'id,offset,source' || !Number.isSafeInteger(request.id) || request.id < 1 || typeof request.source !== 'string' || request.source.length > sqliteCompletionLimits.sourceUnits || !Number.isSafeInteger(request.offset) || request.offset < 0 || request.offset > request.source.length) {
    self.postMessage({ id: request?.id, result: { status: 'blocked', reason: 'input' } }); return;
  }
  self.postMessage({ id: request.id, result: analyzeSqliteLocalReferences(request.source, request.offset) });
};
self.postMessage({ type: 'dbark-sqlite-local-references-ready', version: 1 });
