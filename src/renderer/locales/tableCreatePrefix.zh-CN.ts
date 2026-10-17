/** 只说明新表前缀的用户选择，不在表单暴露令牌或目录实现细节。 */
export const tableCreatePrefixZh = {
  edit: '设置索引键部分', legacy: '清除前缀并使用整字段列表', add: '添加键部分', remove: '删除键部分', column: '选择索引字段', length: '前缀长度（留空为完整字段）',
  hint: '字符列前缀按字符数，二进制列前缀按字节数。唯一索引会约束所选前缀的唯一性。',
  scope: '前缀新表首片支持 MySQL 8.4.11、InnoDB、DYNAMIC 和 16KiB 页；不支持主键前缀及含外键的前缀新表。无法证明类型或整条索引预算时不生成预览。',
  unavailable: '缺少本次新表前缀能力事实，请重新准备；未生成可执行预览。',
  field: (index: number, part: number) => `第${index}个索引第${part}个键字段`,
  prefix: (index: number, part: number) => `第${index}个索引第${part}个前缀长度`,
};
