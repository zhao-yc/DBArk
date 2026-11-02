export interface SqlFunctionSignature {
  readonly parameters: readonly string[];
  readonly description: string;
  readonly variadic?: boolean;
  readonly distinct?: boolean;
}
type Entry = Readonly<{ mysql: readonly SqlFunctionSignature[]; sqlite: readonly SqlFunctionSignature[] }>;
const entries = new Map<string, Entry>();
/** 签名和中文说明集中管理，均为固定内置资料，不包含用户SQL或目录原文。 */
function signature(description: string, parameters: string[], variadic = false, distinct = false): SqlFunctionSignature {
  return Object.freeze({ parameters: Object.freeze(parameters), description, ...(variadic ? { variadic: true } : {}), ...(distinct ? { distinct: true } : {}) });
}
/** 未声明方言不借用另一驱动的参数形式；别名保留用户所用函数名。 */
function add(names: string[], mysql: SqlFunctionSignature[], sqlite = mysql): void {
  const value = Object.freeze({ mysql: Object.freeze(mysql), sqlite: Object.freeze(sqlite) }); for (const name of names) entries.set(name, value);
}
add(['ABS'], [signature('返回绝对值。', ['数值'])]);
add(['ROUND'], [signature('按数据库规则取整。', ['数值']), signature('按指定位数舍入，精度和规则由数据库决定。', ['数值', '位数'])]);
add(['IFNULL'], [signature('第一个值非NULL时返回它，否则返回第二个值。', ['值', '替代值'])]);
add(['NULLIF'], [signature('两个值相等时返回NULL，否则返回第一个值。', ['值1', '值2'])]);
add(['COALESCE'], [signature('返回首个非NULL值。', ['值']), signature('返回首个非NULL值，后续值可重复。', ['值1', '其他值'], true)], [signature('返回首个非NULL值，至少两个参数。', ['值1', '其他值'], true)]);
add(['LENGTH'], [signature('返回长度；字节、字符及模式差异由数据库决定。', ['字符串'])], [signature('文本返回字符数，BLOB返回字节数。', ['值'])]);
add(['LOWER'], [signature('返回小写文本；具体字符转换由数据库决定。', ['字符串'])]);
add(['UPPER'], [signature('返回大写文本；具体字符转换由数据库决定。', ['字符串'])]);
add(['REPLACE'], [signature('用新串替换原串中的匹配子串。', ['原字符串', '查找串', '替换串'])]);
add(['SUBSTR', 'SUBSTRING'], [signature('从指定位置截取后续内容。', ['字符串', '起始位置']), signature('从指定位置截取指定长度。', ['字符串', '起始位置', '长度'])]);
for (const name of ['TRIM', 'LTRIM', 'RTRIM']) { const side = name === 'TRIM' ? '两侧' : name === 'LTRIM' ? '左侧' : '右侧'; add([name], [signature(`移除${side}空格。`, ['字符串'])], [signature(`移除${side}空格。`, ['字符串']), signature(`移除${side}属于字符集的字符。`, ['字符串', '字符集'])]); }
add(['INSTR'], [signature('返回子串首次出现的位置，未找到时返回0。', ['字符串', '子串'])]);
add(['COUNT'], [signature('统计行数或非NULL值；星号表示统计行。', ['表达式或 *']), signature('对非NULL值组合去重计数。', ['表达式'], true, true)], [signature('统计行数或非NULL值，支持单表达式DISTINCT。', ['表达式或 *']), signature('单表达式去重计数。', ['表达式'], false, true)]);
for (const name of ['SUM', 'AVG']) add([name], [signature(name === 'SUM' ? '合计非NULL值。' : '计算非NULL值平均值。', ['表达式'])]);
for (const name of ['MIN', 'MAX']) add([name], [signature('返回非NULL聚合极值。', ['表达式'])], [signature('返回非NULL聚合极值。', ['表达式']), signature('比较多个值并返回极值。', ['值1', '其他值'], true)]);
add(['CONCAT'], [signature('连接多个值，NULL及模式差异按当前数据库规则处理。', ['值'], true)], []);
add(['CONCAT_WS'], [signature('使用分隔串连接后续值。', ['分隔串', '值'], true)], []);
add(['CHAR_LENGTH'], [signature('返回字符数。', ['字符串'])], []);
for (const name of ['LEFT', 'RIGHT']) add([name], [signature('从指定一侧取得指定数量的字符。', ['字符串', '字符数'])], []);
add(['IF'], [signature('按条件选择真值或假值。', ['条件', '为真时的值', '为假时的值'])], []);
add(['MOD'], [signature('返回除法余数。', ['被除数', '除数'])], []);
add(['CEIL', 'FLOOR'], [signature('返回向上或向下取整的整数值。', ['数值'])], []);
add(['GROUP_CONCAT'], [], [signature('连接非NULL值，默认逗号分隔。', ['表达式']), signature('使用分隔串连接非NULL值。', ['表达式', '分隔串'])]);
add(['TOTAL'], [], [signature('返回浮点合计；空集合返回0.0。', ['表达式'])]);
add(['HEX'], [], [signature('返回值的十六进制表示。', ['值'])]);

/** 仅查固定名称表，不接受配置、路径或可执行内容。 */
export function sqlFunctionSignatures(name: string, dialect: 'mysql' | 'mariadb' | 'sqlite'): readonly SqlFunctionSignature[] | undefined {
  const value = entries.get(name); const signatures = dialect === 'sqlite' ? value?.sqlite : value?.mysql; return signatures?.length ? signatures : undefined;
}
export const sqlSignaturesZh = Object.freeze({ notice: '常用内置函数语法资料；不执行SQL，也不代表当前连接的函数可用性。', repeated: '后续参数沿用此形式。' });
