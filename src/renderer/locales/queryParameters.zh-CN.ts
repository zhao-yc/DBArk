/** 类型参数查询文案集中管理，值只在当前表单保留，不进入持久化工作区。 */
export const parameterZh = {
  title: '类型参数查询', open: '参数执行', hint: '以 :name 表示一个值参数。选区优先；没有选区时使用全部 SQL。重复名称共用一个值，表名和列名请直接写在 SQL 中。',
  transactionUnknown: '事务状态需核对', transactionUnknownHint: '服务器错误包不提供当前事务状态。可明确提交或回滚；后续成功查询会按实际协议状态更新提示，不会自动重放写操作。',
  source: '本次 SQL 模板', sourceTruncated: '模板较长，预览仅显示前 65536 个字符，执行使用完整原文。',
  namesLoading: '正在读取当前会话并识别参数…', retry: '重新识别参数', noParameters: '当前可分析语句没有发现值参数。动态脚本可手动添加后续语句需要的参数。',
  privacy: '历史仅保留模板，参数值不写入历史或工作区，关闭标签后释放。结果和快照可能包含实际值。',
  namesDynamic: '当前会话模式或脚本中的模式变更无法完整静态确定。名称预览可能不完整，可添加后续参数；后续解析或绑定错误不能撤销此前已经提交的语句。',
  name: '参数名称', type: '参数类型', value: '参数值', add: '添加参数', remove: '移除手动参数', execute: '执行参数 SQL',
  text: '文本', integer: '整数', decimal: '小数', boolean: '布尔值', date: '日期', datetime: '日期时间', time: '时间 / 时长', binary: '二进制（Hex）', null: 'NULL',
  booleanHint: 'true 或 false', binaryHint: '偶数位十六进制，例如 00ff，不带 0x', dateHint: 'YYYY-MM-DD', datetimeHint: 'YYYY-MM-DD HH:mm:ss.123456', timeHint: '[-]HH:mm:ss.123456',
  numericHint: '普通十进制；保留原始精度，不接受指数或 SQL 表达式', textHint: '空字符串也作为一个实际值',
  sqliteTypeTitle: 'SQLite 参数类型与亲和性', sqliteTypeHint: 'SQLite 小数、日期、日期时间和时长参数按 TEXT 原文绑定，并非原生 DECIMAL 或日期类型。数值亲和列、比较和运算可能由 SQLite 转换数值并损失精度；需要时请在 SQL 中显式处理。整数限有符号 64 位，布尔绑定整数 0/1，Hex 绑定真实 BLOB；不会生成 CAST 或拼接值字面量。',
  sqliteIntegerHint: '有符号64位整数：-9223372036854775808～9223372036854775807', sqliteDecimalHint: '普通十进制TEXT，最多65位有效数字/38位小数；SQLite亲和性可能转换精度',
  sqliteDateNote: 'SQLite 日期/日期时间/时长保留 TEXT 原文。公历年份 0001～9999，拒绝零日期及无效日期；不转换 Date、时区或微秒，时长小时范围 00～838。',
  sqliteNamesHint: 'SQLite 已识别整份模板的全部参数名称；参数组必须完整匹配，不接受缺项或额外手动参数。', sqliteNoParameters: '当前 SQLite 模板没有值参数。',
  sqliteSourceChanged: 'SQLite参数原表单、连接或物理会话已失效，请关闭后重新识别；不会借用新会话或自动重放。',
  dateNote: '日期类型校验有效日历，年份 1000～9999。需要数据库零日期时使用文本类型，由服务器 SQL 模式决定是否接纳。日期时间不接受时区后缀，微秒保持原样。',
};
