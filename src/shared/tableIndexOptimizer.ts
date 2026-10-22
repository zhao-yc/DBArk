/** 索引优化器状态的共用中文说明；不将原始SQL或目录行写进错误摘要。 */
export const indexOptimizerAcknowledgement = 'index-optimizer-change';
export const indexOptimizerMessages = {
  unsupported: '当前精确版本不支持本批索引优化器参与状态切换；MySQL 5.7仅可查看。',
  unavailable: '索引优化器属性的完整目录、原生索引角色或权限尚未证明，请重新读取或核对权限。',
  readonly: '该索引含未知、生成、隐藏字段或特殊属性，不能切换优化器参与状态。',
  primary: '显式或实际隐式聚簇主键不能切换优化器参与状态。',
  foreign: '目标索引可能支撑外键，当前不能证明切换符合该服务器的外键规则。',
  changed: '索引优化器属性、实体身份或完整依赖已变化，请重新读取与预览；未发送DDL。',
  warning: '此操作只改变优化器可用性，不删除索引或唯一约束；优化器是否实际选用仍由服务器决定。',
  window: '请在维护窗口暂停并行结构修改；执行前重核不是跨客户端原子比较与交换。',
} as const;
