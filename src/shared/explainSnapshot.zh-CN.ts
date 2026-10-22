/** 执行计划文件文案由界面、主进程和有界编解码共同使用。 */
export const explainSnapshotZh = {
  entry: '打开计划快照', title: '计划快照', choose: '选择计划快照文件',
  save: '保存计划快照', saveAs: '另存计划快照', saving: '正在保存计划快照…', opening: '正在打开计划快照…',
  notice: '此快照在离线状态只读展示，不连接数据库，也不执行 SQL。',
  saved: (name: string) => `计划快照已保存：${name}`, opened: (name: string) => `已离线打开计划快照：${name}`,
  invalid: '计划快照格式无效、字段不完整或包含不支持的数据',
  tooLarge: '计划快照超过文件或内容预算，未保存或打开',
  busy: '计划快照文件操作尚未结束，请稍后再试', stale: '计划或窗口已变化，本次文件操作结果已失效',
  unknownWrite: '无法确认计划快照是否写入完成，请先核对所选文件',
  defaultName: '执行计划.dbark-plan.json', close: '关闭',
} as const;
