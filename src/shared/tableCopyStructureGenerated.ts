/** 只读服务端计划；表达式始终来自完整SHOW，不接受客户端表达式或生成DDL。 */
export interface TableCopyGeneratedColumn { name: string; storage: 'VIRTUAL' | 'STORED'; expression: string; referencedColumns: string[]; }
export const tableCopyGeneratedText = {
  unsupported: '生成列复制仅支持准确MySQL8.4.11的普通数值VIRTUAL/STORED；其它版本或复杂依赖仅可查看。',
  expression: '生成表达式仅支持前置普通精确数值列、十进制文字量及+/-/*；不求值、不猜引用或复杂依赖。',
  catalog: '生成列SHOW与完整目录的类型、列序、生成方式、表达式或默认属性不一致，当前只读。',
  changed: '生成列完整定义或目录事实已变化，请重新读取；未发送DDL。',
  unproven: '临时、未证明生成或未知字段/物理身份不在复制结构范围。',
  warning: '生成列仅开放准确MySQL8.4.11普通数值VIRTUAL/STORED；隐藏字段、复杂生成依赖、特殊索引、CHECK及已知依赖仍只读。',
};
