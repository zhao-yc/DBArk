export const sqlFieldHoverZh = {
  field: '字段', source: '来源', type: '类型', nullable: '允许NULL', yes: '是', no: '否',
  defaultValue: '默认值（目录文本）', noDefault: '目录返回NULL：无显式默认值或默认NULL',
  extra: '属性', none: '无', comment: '备注', baseType: '基础类型', unknown: '尚未确认',
  temporary: '当前会话临时表', permanent: '永久表或视图', cte: '公共表表达式', derived: '派生表',
  output: 'SELECT输出别名', expression: '类型由查询表达式决定',
  readTemporary: '完整属性须在“会话临时对象”显式读取结构后确认；不会读取同名永久表代替。',
  ambiguous: '未限定字段存在多个候选来源，请使用表别名确认：',
} as const;
