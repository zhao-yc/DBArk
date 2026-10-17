/** SQL编辑器全局字号边界；读取旧记录可回退，显式写入必须严格校验。 */
export const editorFontLimits = { min: 8, max: 32, defaultSize: 13, defaultLineHeight: 23 } as const;
/** 不把字符串、小数、NaN或越界值隐式转换为已授权偏好。 */
export function isEditorFontSize(value: unknown): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= editorFontLimits.min && value <= editorFontLimits.max; }
/** 缺项及损坏的旧记录只在读取时回退，不能将非法输入悄悄截断保存。 */
export function readEditorFontSize(value: unknown): number { return isEditorFontSize(value) ? value : editorFontLimits.defaultSize; }
/** 主进程IPC之外的直接存储入口也必须守住相同整数边界。 */
export function assertEditorFontSize(value: unknown): asserts value is number { if (!isEditorFontSize(value)) throw Error('SQL编辑器字号必须是8–32之间的整数'); }
/** 保留原13/23视觉比例；字号与行高独立于结果网格、浏览器缩放和字体族。 */
export function editorFontOptions(value: unknown): { fontSize: number; lineHeight: number } { const fontSize = readEditorFontSize(value); return { fontSize, lineHeight: Math.round(fontSize * editorFontLimits.defaultLineHeight / editorFontLimits.defaultSize) }; }
