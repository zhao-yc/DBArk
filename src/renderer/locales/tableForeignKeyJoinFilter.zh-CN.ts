/** JOIN条件独立于原表页过滤；所有值均为明确文本，不提供原始SQL条件输入。 */
export const tableForeignKeyJoinFilterZh = {
  title: 'JOIN 条件筛选', hint: '条件写入 JOIN 之后的 WHERE，可使用未输出字段；不继承原表页筛选。LEFT JOIN 的父表条件可能排除未匹配子行，IS NULL 也可能匹配父表字段本身为 NULL 的记录。',
  mode: 'JOIN 条件组合', all: '全部满足（AND）', any: '任一满足（OR）', empty: '尚无 WHERE 条件。',
  add: '添加 JOIN 条件', removeAll: '清空 JOIN 条件', child: '子表 c', parent: '父表 p',
  side: (position: number) => `第 ${position} 项条件来源`, column: (position: number) => `第 ${position} 项条件字段`, operator: (position: number) => `第 ${position} 项条件运算符`, value: (position: number) => `第 ${position} 项条件值`, upper: (position: number) => `第 ${position} 项条件上界`, values: (position: number) => `第 ${position} 项条件集合`, includeEmpty: (position: number) => `第 ${position} 项集合包含空字符串`, enabled: (position: number) => `启用第 ${position} 项 JOIN 条件`, remove: (position: number) => `移除第 ${position} 项 JOIN 条件`,
  scalarHint: '空文本与 NULL 不同；数值按原字符串精确比较，不接受任意 SQL 表达式。', rangeHint: '填写两个完整边界值；保留原文本、精度及先后顺序。', setHint: '每行一个值；逗号、空格、重复值和空行均保留。空集合无效，单独的空字符串需明确勾选。',
  invalid: 'JOIN 条件最多 30 项，必须选择双方真实字段和有效运算符；无效输入请修正或移除。', budget: 'JOIN 条件展开后超过 SQL 预算，请减少条件或集合值；未截断语句。',
  draftBudget: 'JOIN 条件草稿的值内容合计超过 1000000 个字符；本次输入未应用，原草稿保留。',
} as const;
