/** 编码只允许界面公开支持的值，避免任意编码名称意外降级。 */
export function encodingName(encoding: string): string {
  if (!['utf8', 'utf16le', 'gb18030'].includes(encoding)) throw Error('编码必须为 UTF-8、UTF-16LE 或 GB18030');
  return encoding;
}
