import { zh } from './locales/zh-CN';
import type { CellValue, Command, CommandMap, DataRow } from '../shared/contracts';
import { binaryCellFromHex } from './binaryCell';

/** 所有界面请求经由预加载桥接进入主进程，浏览器页面不直接接触凭据或驱动。 */
export function invoke<C extends Command>(command: C, input: CommandMap[C]['input']) {
  if (!window.dbark) return Promise.reject(new Error(zh.commonMessages.text001)) as Promise<CommandMap[C]['output']>;
  return window.dbark.invoke(command, input);
}

/** 为标签、草稿行与任务生成互不复用的标识。 */
export const uid = () => crypto.randomUUID();
/** 保留主进程错误原文，让界面能够展示具体的数据库失败原因。 */
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
/** 对数据库对象名使用反引号转义；此方法不能用于 SQL 值参数。 */
export const identifier = (value: string) => '`' + value.replaceAll('`', '``') + '`';
/** 分别引用库名与对象名，避免含点号或反引号的名称改变 SQL 结构。 */
export const qualifiedName = (database: string, table: string) => `${identifier(database)}.${identifier(table)}`;
/** 未填写的字段是 DEFAULT；只读取自有属性，不能把原型成员误当作数据库单元格。 */
export function ownCell(row: DataRow, key: string): CellValue | undefined { return Object.hasOwn(row, key) ? row[key] : undefined; }
/** 完整文本用于显式查看或复制，二进制转为十六进制且不改变原始数据。 */
export const cellText = (value: CellValue | undefined) => value === null ? 'NULL' : value === undefined ? '' : typeof value === 'object' ? `0x${atob(value.base64).split('').map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join('')}` : String(value);
/** 比较由同一行快照派生的普通数据，包含 NULL、字符串及二进制包装值。 */
export const rowEqual = (a: DataRow, b: DataRow) => JSON.stringify(a) === JSON.stringify(b);
export const kindLabels: Record<string, string> = { table: zh.commonMessages.text002, view: zh.commonMessages.text003, procedure: zh.commonMessages.text004, function: zh.commonMessages.text005, trigger: zh.commonMessages.text006, event: zh.commonMessages.text007 };

/** 网格只渲染短预览，避免大文本或 BLOB 为每个可见单元格创建巨量 DOM 字符串。 */
export function cellPreview(value: CellValue | undefined, limit = 240) {
  if (value && typeof value === 'object') {
    const prefix = cellText({ type: 'binary', base64: value.base64.slice(0, Math.ceil(limit / 6) * 4) });
    return prefix.length > limit || value.base64.length > Math.ceil(limit / 6) * 4 ? prefix.slice(0, limit) + '…' : prefix;
  }
  const text = cellText(value); return text.length > limit ? text.slice(0, limit) + '…' : text;
}

/** 普通文本保留为字符串，避免编辑器把大整数或十进制金额转换成浮点数。 */
export function parseCell(text: string, mode: 'text' | 'json' | 'binary' | 'null'): CellValue {
  if (mode === 'null') return null;
  if (mode === 'json') { JSON.parse(text); return text; }
  if (mode === 'binary') return binaryCellFromHex(text);
  return text;
}
