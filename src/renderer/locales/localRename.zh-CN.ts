export const localRenameZh = {
  unavailable: '只能重命名当前语句中已确认的表别名或 CTE；字段、数据库对象及不确定绑定暂不支持。',
  collision: '新名称已在当前语句中使用，可能改变绑定，请换一个名称。',
  unresolved: '当前语句存在未确认或不同作用域的同名词，无法保证完整重命名。',
  name: '名称不能为空、包含控制字符或超出当前方言的标识符范围。',
  stale: '编辑器、语句或连接上下文已改变，请重新按 F2。',
  dismiss: '关闭重命名提示',
} as const;
