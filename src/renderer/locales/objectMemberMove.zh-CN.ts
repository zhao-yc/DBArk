/** 对象成员按原文序号移动，名称重复或转义不改变定位方式。 */
export const objectMemberMoveZh = {
  title: '移动 JSON 对象成员', object: '只有对象可以移动成员', empty: '空对象没有可移动成员',
  changed: 'JSON 对象或成员身份已变化，不能移动成员', range: '成员序号超出当前对象范围',
  position: '请输入从 1 开始的完整十进制成员序号', limited: '对象成员移动超过原 JSON 文本预算',
  fromLabel: '原成员序号（从 1 开始）', toLabel: '目标成员序号（从 1 开始）',
  count: '当前对象有 {0} 个成员，序号与记录树一致；目标序号表示移动后的最终位置。',
  hint: '按序号移动成员，重复名称分别保留；目标序号为移动后的最终位置。仅暂存本页草稿。',
} as const;
