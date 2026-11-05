export const postgresDependenciesZh = {
  open: '查看依赖', title: 'PostgreSQL 对象依赖',
  referencedBy: '被哪些对象引用', references: '依赖哪些对象',
  kind: '对象类型', identity: '对象标识', type: '依赖类型',
  hidden: '当前角色不可见的对象', empty: '目录中没有直接依赖。',
  hint: '仅显示数据库目录记录的直接依赖。删除时以 PostgreSQL 的实时检查为准。',
  limited: '依赖结果超过显示预算，此处仅显示部分条目。',
  loading: '正在读取对象依赖…', back: '返回对象',
  types: { n: '普通依赖', a: '自动依赖', i: '内部依赖', e: '扩展成员', x: '扩展自动依赖', P: '分区主依赖', S: '分区次依赖' },
  kinds: { table: '表', view: '视图', 'materialized view': '物化视图', 'partitioned table': '分区表', 'foreign table': '外部表',
    sequence: '序列', schema: 'schema', 'table column': '表字段', 'view column': '视图字段',
    'column default': '字段默认值', 'generated column': '生成字段', 'table constraint': '表约束',
    function: '函数', procedure: '过程', type: '类型', extension: '扩展', index: '索引', trigger: '触发器', rule: '规则' },
} as const;
