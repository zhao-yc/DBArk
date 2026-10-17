/** 旧记录缺项或损坏时只回退开关，保留整个工作区；显式写入仍严格校验。 */
export const defaultEditorWordWrap = true;
/** IPC之外的直接存储入口同样只接受原始布尔值。 */
export function assertEditorWordWrap(value: unknown): asserts value is boolean { if (typeof value !== 'boolean') throw Error('SQL编辑器自动换行必须是布尔值'); }
/** 读取仅布尔原值可信；缺项/损坏局部回退true，不抛错丢弃旧SQL，也不按真值强转。 */
export function readEditorWordWrap(value: unknown): boolean { return typeof value === 'boolean' ? value : defaultEditorWordWrap; }
/** Monaco使用明确on/off，不涉及字号、字体族或任何模型操作。 */
export function editorWordWrapOptions(value: unknown): { wordWrap: 'on' | 'off' } { return { wordWrap: readEditorWordWrap(value) ? 'on' : 'off' }; }
