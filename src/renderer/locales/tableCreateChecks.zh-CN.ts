export const tableCreateChecksZh = {
  title: 'CHECK 约束', add: '新增 CHECK 约束', empty: '尚未添加命名表级 CHECK 约束。',
  draft: '这里编辑的是待提交草稿，尚未经过实际会话和服务器验证。名称、表达式和生效意图会进入原新建表 SQL 预览。',
  capability: '实际版本和 CHECK 能力在确认阶段读取。NOT ENFORCED 不是通用停用开关；MySQL 5.7 或不支持的 MariaDB 状态会被拒绝，不会静默忽略。',
  dependency: '字段改名不会自动改写 CHECK 表达式；删除字段后，引用和表达式可用性由服务器检验，请审阅完整预览。',
  nullable: 'CHECK 不等同于 NOT NULL；NULL 可能符合检查。此处不会改变字段的可空、默认值、索引或外键。',
  budget: '表达式原文不会修剪、格式化或截断；名称、数量和表达式预算在预览前严格检查。',
  ack: '我已了解 CHECK 与 NULL 的语义，生效状态取决于实际服务器及写入会话；NOT ENFORCED 不阻止不符合条件的数据。',
  existing: '已有表通用修改不能接收新表 CHECK 草稿；请使用独立 CHECK 约束管理。',
  name: (row: number) => `第${row}个 CHECK：名称`, expression: (row: number) => `第${row}个 CHECK：完整表达式`, enforced: (row: number) => `第${row}个 CHECK：要求检查生效`,
  row: (row: number) => `新表 CHECK ${row}`, remove: (row: number) => `删除第${row}个 CHECK`, up: (row: number) => `上移第${row}个 CHECK`, down: (row: number) => `下移第${row}个 CHECK`,
  enforceIntent: '要求检查生效（待服务器确认）', notEnforcedIntent: '要求 NOT ENFORCED（待服务器确认）',
  previous: '上一页', next: '下一页', page: (page: number, count: number) => `CHECK 草稿 ${page} / ${count} 页`, count: (count: number) => `共 ${count} 项，最多 512 项`,
} as const;
