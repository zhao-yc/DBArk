/** 执行计划文件文案由界面、主进程和有界编解码共同使用。 */
export const explainSnapshotZh = {
  entry: '打开计划快照', title: '计划快照', choose: '选择计划快照文件',
  save: '保存计划快照', saveAs: '另存计划快照', saving: '正在保存计划快照…', opening: '正在打开计划快照…',
  notice: '快照离线只读，不执行 SQL。计划条件和业务值可能包含敏感内容，保存或分享前请核对。',
  actual: '实际执行分析快照：展示此前已执行的分析结果，离线打开不会重跑 SQL。',
  estimated: '估算执行计划快照：成本与行数是优化器估计，不表示实际耗时。',
  unavailable: '当前显示的实际计划缺少对应结果，无法保存快照。',
  saved: (name: string) => `计划快照已保存：${name}`, opened: (name: string) => `已离线打开计划快照：${name}`,
  invalid: '计划快照格式无效、字段不完整或包含不支持的数据',
  tooLarge: '计划快照超过文件或内容预算，未保存或打开',
  busy: '计划快照文件操作尚未结束，请稍后再试', stale: '计划或窗口已变化，本次文件操作结果已失效',
  unknownWrite: '无法确认计划快照是否写入完成，请先核对所选文件',
  defaultName: '执行计划.dbark-plan.json', close: '关闭',
} as const;
