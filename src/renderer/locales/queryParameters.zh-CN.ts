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
  dateNote: '日期类型校验有效日历，年份 1000～9999。需要数据库零日期时使用文本类型，由服务器 SQL 模式决定是否接纳。日期时间不接受时区后缀，微秒保持原样。',
};
