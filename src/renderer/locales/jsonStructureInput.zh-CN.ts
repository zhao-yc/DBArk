/** 结构操作的中文错误，完整字段校验失败时保留原始输入。 */
export const jsonStructureInputZh={changed:'JSON文档或节点身份已变化，不能应用结构操作',key:'成员名称必须是完整JSON字符串token',value:'新值必须是完整有效JSON',root:'根值不能删除或改名，请使用值编辑',object:'所选节点不是对象',array:'所选节点不是数组',index:'数组下标超出当前结构范围',parent:'所选成员或元素的父容器已失效',limited:'结构操作超过原JSON文本预算',combined:'结构操作后的完整JSON不满足原解析预算'} as const;
