export const connectionsTransferZh = {
  title: '连接概要导入导出', open: '连接导入导出', copy: '复制连接概要', copyName: '{0} 副本', copyHint: '未复制密码、私钥或证书。请补充密码并重新选择本机认证文件。',
  copyAction: '复制连接概要 {0}',
  export: '导出连接概要', import: '导入连接概要', hint: '仅传输连接概要，不含密码、私钥或证书。默认新增或跳过；替换前须逐项确认目标与风险。',
  idReason: '来源 ID 相同', nameReason: '名称相同', targetReason: '目标相同', count: '新增 {0}，跳过 {1}', expired: '预览已过期，请重新读取文件并确认。',
  enabled: '启用', disabled: '禁用', ssh: 'SSH 目标与指纹', tls: 'TLS 与服务器证书验证', verify: '验证服务器证书', noVerify: '不验证服务器证书', pendingFiles: '仍需重新选择本机认证文件',
  saveBeforeTest: '已有暂存连接重新选择本机文件后，请先保存，再测试连接。',
  select: '选择要导出的连接', all: '全选连接', chooseExport: '选择概要导出文件', chooseImport: '选择概要导入文件', defaultName: 'DBArk连接概要', exportStart: '确认导出连接概要', exported: '连接概要已导出', preview: '读取并预览概要文件', source: '来源连接概要', target: '数据库目标', candidates: '现有同名或同目标候选', none: '无候选', action: '导入处理', add: '作为新连接新增', skip: '跳过',
  confirm: '确认批次新增连接', imported: '连接概要批次已导入；新连接尚未测试，请补充认证。', fileHint: '源文件仅提供认证文件名；须重新选择本机私钥或证书。', staged: '我确认仅暂存概要，稍后补充密码并重新选择本机私钥/证书文件',
  paths: '源文件认证提示（不能直接访问）', pending: '正在处理本地概要文件', fail: '操作失败，没有自动重试。请核对结果后重新明确发起。', noSelection: '请至少选择一个连接。', chooseLocal: '重新选择本机认证文件',
  replace: '明确替换已有连接', replaceTarget: '本机替换目标', chooseTarget: '请选择本机目标，不会自动匹配', reviewReplace: '审阅本批替换', reviewTitle: '不可变替换确认', oldTarget: '旧本机概要', newTarget: '新来源概要', replaceConfirm: '确认本批新增与受控替换', replacedCount: '新增 {0}，替换 {1}，跳过 {2}',
  changed: '连接列表已变化，请重新读取文件；原确认已取消。', reviewRequired: '请先审阅当前源→目标选择，再逐项勾选风险。', noFiles: '未声明认证文件；仍须重新核对认证', missingFiles: '替换后待重新选择', linkedNotice: '保留目标ID，已有历史、查询、收藏和布局不迁移到新身份，使用前请逐项复核。',
  sshPrivateKey: 'SSH私钥', tlsCa: 'TLS CA', tlsCert: 'TLS客户端证书', tlsKey: 'TLS客户端私钥', oldToNew: '旧到新',
};
