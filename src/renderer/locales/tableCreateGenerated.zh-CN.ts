export const tableCreateGeneratedZh = {
  title: '字段计算方式', ordinary: '普通字段', virtual: 'VIRTUAL 虚拟生成列', stored: 'STORED 存储生成列',
  mode: (position: number) => `第${position}个字段：计算方式`,
  expression: (position: number) => `第${position}个字段：生成表达式`,
  references: (position: number) => `第${position}个字段：草稿前序可引用字段`,
  hint: '生成列仅支持整数或 DECIMAL，允许 NULL，无默认值、自增或自动更新时间。表达式支持十进制文字量、前序普通精确数值列、加减乘、括号与一元正负；名字含特殊字符时用反引号，反引号写成两个。上限2048字符、256词法单元、16层、32次引用。',
  planned: '以下候选来自当前新表草稿，不代表已存在的数据库字段；改名、移动或删除字段后重新校验，不自动改写表达式。',
  noReferences: '当前没有可引用的前序普通精确数值字段；仍可使用十进制常量。',
  invalid: '生成列草稿无效，请检查类型、表达式、前序依赖及索引/外键成员。',
  keys: '本版生成列自身不能加入索引、主键或外键；普通字段的键不受影响。',
  capability: '服务器未提供可确认的新表生成列能力；未发送 CREATE，可返回保留结构草稿。',
  confirmation: '本次新表包含生成列；以下固定表达式仅由服务器在创建及后续写入时处理，不在客户端提前求值。',
  ack: '我已核对新表生成表达式、精度、溢出、NULL 传播与服务器 sql_mode；值由服务器计算，不提前求值、不自动重放',
} as const;
