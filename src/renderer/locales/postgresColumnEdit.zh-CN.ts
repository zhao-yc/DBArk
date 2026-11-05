export const postgresColumnEditZh = {
  open: '编辑字段', title: 'PostgreSQL 字段编辑', add: '新增字段', rename: '重命名字段',
  operation: '操作',
  from: '原字段', name: '新字段名', type: '数据类型', length: '长度', precision: '精度', scale: '小数位',
  nullable: '允许空值', useDefault: '设置文字默认值', defaultValue: '默认值', comment: '字段注释',
  stage: '加入改动', undo: '撤回最后一项', preview: '预览字段 SQL', apply: '确认提交字段修改',
  close: '退出字段编辑', draft: '待提交改动', previewTitle: '实际提交 SQL',
  changed: '原表或连接已变化，请重新读取结构。',
  dirty: '原表页还有草稿或操作正在进行，请先处理。',
  unknown: '提交结果待核对，请退出字段编辑后刷新实际结构。',
  adding: (name: string) => '新增 ' + name,
  renaming: (from: string, name: string) => '重命名 ' + from + ' → ' + name,
} as const;
