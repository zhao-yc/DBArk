# PostgreSQL 查询作用域补全

在[基础目录补全](postgres-completion-20261105.md)上增加 CTE 名称和字段、派生表输出以及子查询内部的字段补全。在关系位置按 Ctrl+空格可选当前作用域内的 CTE，继续输入别名加点号可选该关系的输出列。

```sql
WITH order_totals AS (
  SELECT customer_id, SUM(amount) AS total
  FROM public.orders
  GROUP BY customer_id
)
SELECT totals.total FROM order_totals AS totals;
```

- CTE 按声明可见范围解析，内层同名 CTE 遮蔽外层定义。物理表仍可通过 schema 显式选择。写入目标继续按实际表补全。[PostgreSQL WITH 查询](https://www.postgresql.org/docs/18/queries-with.html)
- 支持显式列名列表、直接字段、常见投影别名和可确定的通配输出。递归查询可使用显式列名，并能从常见 UNION 锚点推导递归分支的字段。子查询能识别相关外层别名，LATERAL 读取同层已在左侧绑定的来源。[PostgreSQL 表表达式](https://www.postgresql.org/docs/18/queries-table-expressions.html)
- 集合运算中按当前分支补全，组合结果的 ORDER BY 使用首分支输出。重复的派生输出名称在候选中省略。[PostgreSQL SELECT 列表](https://www.postgresql.org/docs/18/queries-select-lists.html)
- 编辑器本地解析已知名称。通配字段沿原只读目录读取，并以外层别名插入，保持类型提示。请求仅含目录目标和前缀，查询会话、事务和执行历史仍独立。

## 范围

目录仍按默认角色及搜索路径读取。会话临时对象、SET ROLE 和搜索路径变更仍待接入。NATURAL／USING 合并后的裸通配输出、位置重命名后的未知通配尾部、复杂表达式的隐式命名和递归前向依赖的全部推导继续推进。

## 验证

- Mac 类型检查、源码构建和 13 项定向单元测试通过。定向覆盖声明顺序、同名遮蔽、列重命名、递归锚点、相关作用域、集合分支，以及本地字段补全不发目录请求。
- Mac 完整回归覆盖 1,317 个测试文件，27,396 项通过，10 项 Windows 系统 tar 检查按平台跳过。
- Server-200 的 PostgreSQL 18 独占容器完成 5 项实库回归。Mac 原生 Electron 整例通过，真实按键接纳 CTE 中文列和派生表实库通配列，核对实际插入文字及执行历史。单 worker、120 秒、零重试、trace 关闭。
- 两个独占实库验收均复核原行、零连接并清理容器。Mac 窗口正常退出，临时配置目录已清理。
- 首次完整回归的 MySQL TLS 测试因沙箱拒绝绑定本机回环端口而失败，原始结果保留。复验沿用相同测试范围和断言，允许回环监听。
- WIN11-TEST 会话不可达，本轮未派发，按约定在 Mac 验证。Windows 原生窗口及安装包仍待验收。
