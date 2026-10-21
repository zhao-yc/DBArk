import { expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { installQueryResultColumnsAudit, queryResultColumnsSql } from '../helpers/queryResultColumnsUi';

/** 实际Main审计函数执行于RAM端口，原处理器只模拟准确文件令牌，不创建文件或客户端。 */
function audit(options: Record<string, unknown> = {}) {
  const original = vi.fn(async (_event: unknown, request: any) => ({ ok: true, result: request.command === 'files.choose' ? { token: request.input.format, name: 'visible-selected.' + request.input.format } : { rows: 2 } }));
  const handlers = new Map([['dbark:request', original]]), target = { senderId: 1, profileId: 'c', tabId: 't', sql: queryResultColumnsSql, deadline: 120000, ...options };
  const context: any = { Date: { now: () => 1 }, ipcMain: { _invokeHandlers: handlers }, target };
  runInNewContext(`(${installQueryResultColumnsAudit.toString()})({ipcMain},target)`, context);
  const send = (command: string, input: Record<string, unknown> = {}) => handlers.get('dbark:request')!({ sender: { id: 1 } }, { command, input });
  return { send, original, context };
}

it('默认旧例不获得XLSX授权且拒绝后永久停链', async () => {
  const f = audit(); await expect(f.send('files.choose', { purpose: 'export', format: 'xlsx' })).rejects.toThrow('文件选择');
  expect(f.original).not.toHaveBeenCalled(); await expect(f.send('tasks.list')).rejects.toThrow('停链');
});
it('Excel独立例只允许CSV与XLSX各一次，按原真实令牌导出', async () => {
  const f = audit({ excel: true });
  for (const format of ['csv', 'xlsx']) { await f.send('files.choose', { purpose: 'export', format }); await f.send('files.exportResult', { format, fileToken: format, encoding: 'utf8' }); }
  expect(f.original).toHaveBeenCalledTimes(4); expect(f.context.__dbarkQueryResultColumnsAudit.exports).toEqual(['csv', 'xlsx']);
  await expect(f.send('files.choose', { purpose: 'export', format: 'xlsx' })).rejects.toThrow('文件选择'); expect(f.original).toHaveBeenCalledTimes(4);
});
it('Excel例不能同时借旧JSON授权扩大文件次数', async () => {
  const f = audit({ excel: true }); await expect(f.send('files.choose', { purpose: 'export', format: 'json' })).rejects.toThrow('文件选择'); expect(f.original).not.toHaveBeenCalled();
});
it.each([{ encoding: 'gb18030' }, { fileToken: '别的文件' }, { csvDelimiter: '\t' }, { sql: {} }])('XLSX拒绝隐藏文本配置和错误文件令牌：%j', async change => {
  const f = audit({ excel: true }); await f.send('files.choose', { purpose: 'export', format: 'xlsx' });
  await expect(f.send('files.exportResult', { format: 'xlsx', encoding: 'utf8', fileToken: 'xlsx', ...change })).rejects.toThrow('文件导出'); expect(f.original).toHaveBeenCalledOnce();
});
it.each([{ excel: false }, { excel: 'true' }, { excel: true, presets: true }])('拒绝非明确或混合授权%j', options => { expect(() => audit(options)).toThrow('Excel授权形状'); });
