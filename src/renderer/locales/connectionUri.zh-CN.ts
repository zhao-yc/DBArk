export const connectionUriZh = {
  open: '从连接URI填入', title: '连接URI（可能包含密码）',
  placeholder: 'mysql://user:password@host:3306/database',
  hint: '仅填入新连接表单，不自动连接或保存。用户名、密码和数据库中的保留字符需百分号编码。主机按标准URL规则规范化；SSH／TLS请填入后单独配置。',
  apply: '填入并清除URI', cancel: '取消URI输入',
  applied: '已填入连接信息并清除URI输入。请核对主机和端口；密码默认仅用于会话，按需勾选记住密码。',
} as const;
