/** 旧记录缺少开关时维持既有自动换行；显式非法值不按真值或字符串猜测。 */
export const defaultEditorWordWrap = true;
/** IPC之外的直接存储入口同样只接受原始布尔值。 */
export function assertEditorWordWrap(value: unknown): asserts value is boolean { if (typeof value !== 'boolean') throw Error('SQL编辑器自动换行必须是布尔值'); }
/** 仅缺项兼容默认true；存在的非法值明确拒绝，false必须原样保留。 */
export function readEditorWordWrap(value: unknown): boolean { if (value === undefined) return defaultEditorWordWrap; assertEditorWordWrap(value); return value; }
/** Monaco使用明确on/off，不涉及字号、字体族或任何模型操作。 */
export function editorWordWrapOptions(value: unknown): { wordWrap: 'on' | 'off' } { return { wordWrap: readEditorWordWrap(value) ? 'on' : 'off' }; }
