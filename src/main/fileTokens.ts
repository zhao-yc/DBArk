export interface SelectedFile { path: string; purpose: string; format?: string; }

/** 仅解析当前窗口原生对话框创建且用途匹配的令牌，路径永远由主进程注入。 */
export function resolveFileToken(files: ReadonlyMap<string, SelectedFile>, token: string, purpose: 'import' | 'export' | 'query', format?: string): string {
  const selected = files.get(token);
  if (!selected || selected.purpose !== purpose) throw new Error('文件访问未授权，请通过文件对话框重新选择');
  if (format && selected.format !== format) throw new Error('文件类型未授权，请重新选择 SQL 文件');
  return selected.path;
}
