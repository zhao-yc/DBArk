# Q01 SELECT 输出别名检查点（2026-10-15）

状态：0.16 开发中，Q01 和 Navicat 总目标保持部分。本页接续[元数据与初始化验收](acceptance-q01-session-read-and-warmup-20261015.md)。本检查点尚未公开发行。

## 实际行为

现有查询编辑器的 Ctrl + 空格补全增加 SELECT 输出别名。普通标量别名可用于 ORDER BY、GROUP BY 和 HAVING；聚合别名不用于 GROUP BY，窗口别名不用于 GROUP BY/HAVING。同 SELECT 列表、WHERE、JOIN 条件、窗口或 GROUP_CONCAT 内部的 ORDER BY 不借用当前输出别名。ORDER BY 优先引用输出；GROUP BY/HAVING 遇同名 FROM 字段时保留限定字段建议，不把它说成输出别名。目录不完整或不可用时不推断不存在冲突。

UNION 全局 ORDER BY 使用首分支输出名，分支括号内 ORDER BY 使用自己的投影。星号通过既有有界目录展开，只查实际来源；同次请求合并，不增加重复目录请求。重复或大小写冲突的输出名保守省略并标部分；服务器可能接受相同常量别名，不将此策略写成所有重复名都被服务器拒绝。

字符串别名只有经 AST 确认其位置后才从原 token 解码，普通字符串值仍脱敏。别名按一个名称引用，名称中的点号、中文和反引号不拆分；反斜线模式未知且名称有歧义时省略。物理名称及 IPC 前缀仍限 64 字；长输出别名仅在本地处理，候选总量仍限 256，Worker 的原启动、解析和取消期限不变。

[MySQL 别名文档](https://dev.mysql.com/doc/refman/8.4/en/problems-with-alias.html)说明可引用子句及字符串别名的引用方式；[SELECT 文档](https://dev.mysql.com/doc/refman/8.4/en/select.html)说明同名字段的查找优先级。[MySQL 长度文档](https://dev.mysql.com/doc/refman/8.4/en/identifier-length.html)与[MariaDB 名称文档](https://mariadb.com/docs/server/reference/sql-structure/sql-language-structure/identifier-names)给出声明的字符上限，但不能据此推断长名可按全名引用。六实例固定 SELECT 实测：MySQL 在 256 UTF-8 字节边界可引用，MariaDB 在 255 字节可引用；85 个“字”为255字节可用，86个为258字节引用报1054。256字节的纯ASCII及中文混合名在MySQL可用、MariaDB报1054。当前采用真实服务器方言缓存，离线采用共同的255字节范围；超限不猜截断后的名字并标部分。补全不新增会话探测SQL，不改变用户SQL或设置。

## 分层证据

原件保存在忽略目录 `.cache/o16-sql-completion/`，每轮均保留输入摘要、正式 JSON、原日志和终态。

| 层次 | 当前证据 |
| --- | --- |
| 单元 | `run167-output-alias-unit`：2089 通过、103 文件、0失败/跳过；实际解析器及建议组装覆盖子句、冲突、字符串解码、UNION和UTF-8边界 |
| 类型 | `run168-output-alias-types`、`run175-output-alias-final-types` 退出码0；最终桌面断言收尾后另核 |
| 构建 | `run176-output-alias-build` 退出码0，实际 Electron、Monaco及语义Worker产物 |
| 六实例语义 | `run169`至`run174`，每实例9通过，共54通过、0失败/跳过；使用真实会话缓存、实际候选插入后执行，包含严格TLS |
| 桌面入口 | 本检查点真实Monaco回归进行中，后续以终态更新，不提前记通过 |

新增实库套件只运行常量及派生表 SELECT 和会话模式语句，没有创建库、表、用户或授权。各实例记录实际驱动连接并在关闭 Engine 后通过旁观连接逐 ID 核对，均无残留；旁观连接再严格关闭。新增权限测试授权仍仅限既定隔离资源，本批没有扩大权限。

## 尚未覆盖

这里只完成普通查询块的首批输出别名路径。祖先输出别名在特定标量子查询中的可见性、完整窗口/LATERAL/例程局部名、复杂集合括号恢复及其它方言仍待做；不能把最近查询块隔离当作完整作用域。当前新代码的原生安装、私网安装实库和公开资产均待验证；上一检查点 e9ed54d 的三平台成功不能替代它。Q01仍为部分。
