/** 聚合按JOIN后的行计算，模式切换只改变本地预览，不自动执行或丢弃明细草稿。 */
export const tableForeignKeyJoinSummaryZh = {
  enabled: '生成分组聚合查询', title: 'JOIN 分组与聚合',
  hint: '分组字段和聚合项独立于明细选列。无分组字段时生成全体汇总；也可只分组不聚合。原 WHERE 在聚合之前生效，LIMIT 在聚合与排序之后生效。切回明细会恢复原选列和排序。',
  semantics: 'COUNT(*) 统计 JOIN 后的行；COUNT(父表字段) 不计未匹配或 NULL。父表值可能因多条子行重复参与 SUM/AVG；COUNT DISTINCT 按字段的数据库规则去重。FLOAT/DOUBLE 的聚合仍是近似值，不在客户端转为精确小数。',
  groups: 'GROUP BY 字段', aggregates: '聚合输出', addGroup: '添加分组字段', clearGroups: '清空分组字段', addAggregate: '添加聚合项', clearAggregates: '清空聚合项',
  groupSide: (n:number)=>`第 ${n} 项分组来源`, groupColumn: (n:number)=>`第 ${n} 项分组字段`, groupEarlier: (n:number)=>`上移第 ${n} 项分组`, groupLater: (n:number)=>`下移第 ${n} 项分组`, groupRemove: (n:number)=>`移除第 ${n} 项分组`,
  fn: (n:number)=>`第 ${n} 项聚合函数`, side: (n:number)=>`第 ${n} 项聚合来源`, column: (n:number)=>`第 ${n} 项聚合字段`, alias: (n:number)=>`第 ${n} 项聚合别名`, remove: (n:number)=>`移除第 ${n} 项聚合`, earlier: (n:number)=>`上移第 ${n} 项聚合`, later: (n:number)=>`下移第 ${n} 项聚合`, defaultAlias: (n:number)=>`统计_${n}`,
  functions: {COUNT_ALL:'COUNT(*) · JOIN 行数',COUNT:'COUNT · 非 NULL 数',COUNT_DISTINCT:'COUNT DISTINCT · 非 NULL 不同值',SUM:'SUM · 合计',AVG:'AVG · 平均',MIN:'MIN · 最小值',MAX:'MAX · 最大值'},
  aggregateSide: '聚合输出', staleColumn: (name:string)=>`${name}（已失效，请重新选择）`,
  invalid: '聚合配置无效：最多20个不重复分组字段、32项白名单聚合，必须使用双方真实字段及有效别名。', numeric: 'SUM/AVG 只支持整数、小数或浮点数列，不隐式转换文本、日期、JSON 或二进制。', aliasConflict: '聚合别名必须唯一，不能与分组输出别名重复（不区分大小写）。', empty: '请至少选择一个分组字段或添加一个聚合项；未使用旧明细替代空汇总。', sort: '聚合查询只能按所选分组字段或当前聚合别名排序，请修正失效排序。',
} as const;
