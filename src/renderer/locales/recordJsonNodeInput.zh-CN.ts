/** 记录节点身份与字段暂存的中文文案。 */
export const recordJsonNodeInputZh={
  changed:'记录或JSON节点身份已变化，请重新选择当前节点',pending:'请先处理已有字段输入，再编辑JSON节点',notText:'当前字段不是完整JSON字符串，不能编辑节点值',
  edit:'编辑此节点值',title:'JSON 节点编辑',label:'JSON 节点输入',close:'关闭节点输入',path:'节点结构路径',details:'选中路径与输入限制',
  hint:'替换选中节点的完整 JSON 值，包含对象和数组；字符串须带双引号。暂存只修改本页草稿。',
  scope:'保留其它原文、成员顺序和精确数字。整个字段仍限262144代码单元及UTF-8字节，并校验合并后完整结构；SQL NULL 请使用字段编辑。',
  treeHint:'当前页草稿的有序记录树。显式编辑节点后暂存到本页；实际写入仍需预览并确认。查看和展开不读取或提交数据库。',
} as const;
