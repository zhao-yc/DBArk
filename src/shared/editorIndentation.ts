/** 全局缩进只扩展现有settings JSON，不增加配置库版本或独立存储。 */
export const editorIndentationLimits = { min: 1, max: 8, defaultTabSize: 2, defaultInsertSpaces: true } as const;
/** 显式宽度只接受原始整数，不能把字符串、小数或越界值截断保存。 */
export function isEditorTabSize(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= editorIndentationLimits.min && value <= editorIndentationLimits.max; }
/** 损坏的旧宽度局部回退2，保留SQL、标签与其它偏好，不写回磁盘。 */
export function readEditorTabSize(value: unknown): number { return isEditorTabSize(value) ? value : editorIndentationLimits.defaultTabSize; }
/** 空格沿用锁定Monaco的默认true，旧布尔值不得经真值强转。 */
export function readEditorInsertSpaces(value: unknown): boolean { return typeof value === 'boolean' ? value : editorIndentationLimits.defaultInsertSpaces; }
/** 直接存储入口与IPC共用整数边界，非法输入必须在任何写入之前拒绝。 */
export function assertEditorTabSize(value: unknown): asserts value is number { if (!isEditorTabSize(value)) throw Error('SQL编辑器缩进宽度必须是1–8之间的整数'); }
/** 显式Tab/空格设置只接受布尔值，不接受字符串或数字。 */
export function assertEditorInsertSpaces(value: unknown): asserts value is boolean { if (typeof value !== 'boolean') throw Error('SQL编辑器空格缩进偏好必须是布尔值'); }
/** 缺项兼容旧调用，显式undefined同其它坏值严格拒绝。 */
export function assertEditorIndentationWrite(settings: { editorTabSize?: unknown; editorInsertSpaces?: unknown }): void {
  if (Object.hasOwn(settings, 'editorTabSize')) assertEditorTabSize(settings.editorTabSize);
  if (Object.hasOwn(settings, 'editorInsertSpaces')) assertEditorInsertSpaces(settings.editorInsertSpaces);
}
/** 关闭Monaco自动检测，并同步indentSize，已有正文不得覆盖用户明确选择。 */
export function editorIndentationOptions(tabSize: unknown, insertSpaces: unknown): { tabSize: number; indentSize: number; insertSpaces: boolean; detectIndentation: false } {
  const width = readEditorTabSize(tabSize); return { tabSize: width, indentSize: width, insertSpaces: readEditorInsertSpaces(insertSpaces), detectIndentation: false };
}
