export const importPreflightZh = {
  title: '整文件预检', run: '校验整份文件', cancel: '取消预检', cancelling: '正在取消，等待原任务结束', export: '导出预检报告 JSON',
  running: '正在检查整份文件', exporting: '正在准备或导出报告', cancelled: '已取消预检', failed: '预检失败，请核对来源后重试',
  invalidReport: '预检报告身份或计数不一致，请重新预检', cancelFailed: '取消请求失败，仍在等待原任务结束', exportFailed: '报告导出失败', exported: '报告已导出',
  complete: '已检查整份文件', incomplete: '未完整检查，不能确认整份文件通过', passed: '已映射字段未发现异常',
  blocked: '当前预检未通过，请修正文件或映射后重新预检', reportName: '导入预检报告.json',
  scope: '仅检查已选映射字段的类型、空值及无损表示；未映射字段、默认值、唯一键、外键、CHECK、触发器与匹配键实时约束仍由正式导入核验。预检不会导入数据，也不保证正式导入成功。',
  detail: '明细使用数据记录号，不是文件物理行号。仅保留最多 200 条错误，导出也只包含这些明细及汇总。',
  truncated: '错误明细已截断，计数仍覆盖已检查范围。', record: '数据记录号', source: '源列', target: '目标列', code: '错误代码', message: '说明',
  previous: '上一页明细', next: '下一页明细',
  unavailable: '—',
  summary: (checked: number, valid: number, invalid: number, issues: number, retained: number) => `已检查 ${checked} 条记录；有效 ${valid} 条；异常 ${invalid} 条；错误总数 ${issues} 条；保留明细 ${retained} 条。`,
  issues: {
    'missing-source': '源记录缺少已映射字段', 'invalid-value': '字段值不能确认满足目标类型、空值或无损表示要求',
    'parse-error': '源文件未完整读取或解析，失败记录编号无法确认', 'source-changed': '源文件已变化，请重新选择并预检', 'schema-changed': '目标字段已变化，请重新读取映射并预检'
  }
} as const;
