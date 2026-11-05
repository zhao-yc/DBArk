import { postgresColumnTypeSql } from '../../shared/postgresCreateTable';
import type { PostgresColumnChange } from '../../shared/postgresColumnEdit';

const actions = {
  add: '新增字段', rename: '重命名字段', type: '修改数据类型', nullable: '修改空值约束',
  default: '修改默认值', comment: '修改注释', drop: '删除字段',
} as const;

/** 草稿摘要区分设置和清除，显示实际将影响的字段。 */
function modifying(change: Exclude<PostgresColumnChange, { kind: 'add' | 'rename' }>) {
  const field = change.from;
  switch (change.kind) {
    case 'type': return field + ' → ' + postgresColumnTypeSql(change.dataType);
    case 'nullable': return field + (change.nullable ? ' → 允许空值' : ' → 禁止空值');
    case 'default': return (change.value === null ? '清除默认值 ' : '设置文字默认值 ') + field;
    case 'comment': return (change.value === null ? '清除注释 ' : '设置注释 ') + field;
    case 'drop': return '删除 ' + field;
  }
}

export const postgresColumnEditZh = {
  open: '编辑字段', title: 'PostgreSQL 字段编辑', operation: '操作', actions,
  from: '原字段', name: '新字段名', type: '数据类型', length: '长度', precision: '精度', scale: '小数位',
  nullable: '允许空值', useDefault: '设置文字默认值', defaultValue: '默认值', comment: '字段注释',
  chooseType: '选择目标类型', typeNote: '由 PostgreSQL 转换已有值和默认值。转换或约束检查失败时，整批回滚。',
  clearDefault: '加入后将清除所选字段的默认值。', clearComment: '注释留空会清除所选字段的注释。',
  confirmDrop: '确认删除预览中的字段及其数据。本表内引用这些字段的索引和约束也可能被 PostgreSQL 删除。',
  stage: '加入改动', undo: '撤回最后一项', preview: '预览字段 SQL', apply: '确认提交字段修改',
  close: '退出字段编辑', draft: '待提交改动', previewTitle: '实际提交 SQL',
  changed: '原表或连接已变化，请重新读取结构。',
  dirty: '原表页还有草稿或操作正在进行，请先处理。',
  unknown: '提交结果待核对，请退出字段编辑后刷新实际结构。',
  adding: (name: string) => '新增 ' + name,
  renaming: (from: string, name: string) => '重命名 ' + from + ' → ' + name,
  modifying,
} as const;
