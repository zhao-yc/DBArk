/** 旧8条成功输入逐字保留；对应大写关键字输入与小写期望均手工列出，不由产品生成。 */
export const lowerKeywordCases = [
  {
    name: '名称、变量、字符串、注释和限定名称',
    source: "select MiXeD, `SeLeCt`, \"from\", 'where', @from, @@global.time_zone, t.order from MiXeDTable t where t.id=1; -- select lower",
    uppercaseKeywords: "SELECT MiXeD, `SeLeCt`, \"from\", 'where', @from, @@global.time_zone, t.order FROM MiXeDTable t WHERE t.id=1; -- select lower",
    expected: "select MiXeD, `SeLeCt`, \"from\", 'where', @from, @@global.time_zone, t.order from MiXeDTable t where t.id=1; -- select lower",
  },
  { name: '聚合和当前用户函数', source: 'select count(MiXeD), current_user from T;', uppercaseKeywords: 'SELECT count(MiXeD), current_user FROM T;', expected: 'select count(MiXeD), current_user from T;' },
  { name: '有敏感空白的函数名称', source: 'select MyFn (MiXeD), Db.OtherFn (MiXeD) from T;', uppercaseKeywords: 'SELECT MyFn (MiXeD), Db.OtherFn (MiXeD) FROM T;', expected: 'select MyFn (MiXeD), Db.OtherFn (MiXeD) from T;' },
  { name: 'CAST与数据类型', source: 'select cast(MiXeD as decimal(10,2)) from T;', uppercaseKeywords: 'SELECT cast(MiXeD AS decimal(10,2)) FROM T;', expected: 'select cast(MiXeD as decimal(10,2)) from T;' },
  { name: '多词关键字', source: 'select MiXeD from T group by MiXeD order by MiXeD;', uppercaseKeywords: 'SELECT MiXeD FROM T GROUP BY MiXeD ORDER BY MiXeD;', expected: 'select MiXeD from T group by MiXeD order by MiXeD;' },
  { name: 'IN与括号', source: 'select a from T where a in (1,2);', uppercaseKeywords: 'SELECT a FROM T WHERE a IN (1,2);', expected: 'select a from T where a in (1,2);' },
  { name: 'CASE各分支与别名', source: 'select case when a=1 then 2 else 3 end as value from T;', uppercaseKeywords: 'SELECT CASE WHEN a=1 THEN 2 ELSE 3 END AS value FROM T;', expected: 'select case when a=1 then 2 else 3 end as value from T;' },
  { name: 'DDL名称与类型同形', source: 'create table demo (year year, bit bit(1), name varchar(8));', uppercaseKeywords: 'CREATE TABLE demo (year year, bit bit(1), name varchar(8));', expected: 'create table demo (year year, bit bit(1), name varchar(8));' },
] as const;
