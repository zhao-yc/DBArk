export const tableCreateColumnEncodingZh = {
  title: '字段字符集与排序规则', read: '读取字段编码目录', reread: '重新读取字段编码目录', reading: '正在读取实际字段编码目录并释放准备快照…', cancel: '取消字段编码读取',
  mode: (position: number) => `第${position}个字段：编码方式`, charset: (position: number) => `第${position}个字段：字符集`, collation: (position: number) => `第${position}个字段：排序规则`, clear: (position: number) => `第${position}个字段：清除显式编码`,
  inherit: '继承表默认', explicit: '显式选择实际配对', placeholder: '请选择实际候选',
  hint: '字段编码仅用于本次新建表的普通 CHAR、VARCHAR、TEXT、ENUM、SET 字段；继承模式不指定列编码，不转换已有表。',
  unavailable: '尚无完整有效的服务器编码目录，显式选择暂不可用；继承表默认的普通创建可继续。',
  incompatible: '此字段类型或生成模式不能使用显式编码。原配对仍保留，请清除显式编码或恢复原字段类型。',
  invalid: '字段显式编码必须选择本次实际目录中的完整字符集与排序规则配对。',
  stale: '实际编码目录已变化，请返回重新读取并确认字段配对；未发送 CREATE。',
  response: '新建表字段编码回执与本次列名、位置、配对或目录摘要不一致；不可执行。',
  preparing: '字段编码候选不携带提交权限；确认时会重新读取实际目录，并由服务器校验固定预览。',
  selected: '本次字段显式编码', release: '字段编码准备快照释放失败，候选未发布；请重试读取或关闭以重新释放。',
} as const;
