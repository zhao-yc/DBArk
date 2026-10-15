# Q01 SELECT 输出别名检查点（2026-10-15）

状态：0.16 开发中，Q01 和 Navicat 总目标保持部分。本页接续[元数据与初始化验收](acceptance-q01-session-read-and-warmup-20261015.md)。实现固定于 `b89f760e5cc0b38248bf4bf827c9db46c2b143fe`，Windows本机分层验收已完成，当前新代码三平台CI进行中；尚未公开发行。

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
| 类型 | `run168-output-alias-types`、`run175-output-alias-final-types`及最终`run179-output-alias-frozen-types`退出码0 |
| 构建 | `run176-output-alias-build` 退出码0，实际 Electron、Monaco及语义Worker产物 |
| 六实例语义 | `run169`至`run174`，每实例9通过，共54通过、0失败/跳过；使用真实会话缓存、实际候选插入后执行，包含严格TLS |
| 源码桌面 | `run177-output-alias-regression`：32通过、0失败/跳过/flaky，235057ms；包含真实Monaco接受、完整范围替换、撤销和不重写模型的实际执行，逐行核对结果顺序，同时回归会话/查询上下文、参数及流式导出 |
| 真实安装 | `run178-output-alias-installed-regression`：独立NSIS安装的同32项通过、0失败/跳过/flaky，247708ms；真实卸载后本次安装及临时目录清理确认 |
| 安装内容 | 105个dist文件与包内逐字节相等；实际安装的app.asar与构建归档SHA256相等；安装程序SHA256为`28e17d3e9d77f12b7297f61fce8352c6b4709f68970063c16754cc94a734fad8`，仅本机构建，未公开发行 |
| 独立资源检查 | `run180-output-alias-cleanup`：六实例隔离库/用户/相关线程为0，本机项目进程和本批临时目录为0，13个历史目录保留 |

新增实库套件只运行常量及派生表 SELECT 和会话模式语句，没有创建库、表、用户或授权。各实例记录实际驱动连接并在关闭 Engine 后通过旁观连接逐 ID 核对，均无残留；旁观连接再严格关闭。新增权限测试授权仍仅限既定隔离资源，本批没有扩大权限。

`o16-output-alias-checkpoint-attestation.json`逐层核对实际可执行输入：单元、类型、构建、实库套件、源码桌面和安装桌面分别限定范围，并核对构建文件及安装摘要；没有用文档变动替代代码验证。包内检查的首次工具探测因Windows版asar API的原生路径分段规则报“未找到dist/main/index.cjs”；改用`node:path.normalize`后全部105文件逐字节核对通过，未修改或重打包应用，首次错误保留在包内容证据中。私有安装入口复用正式安装/精确卸载流程，仅切换本批产物、32项测试和显式私网开关；原日志沿用“离线安装程序回归”文字，实际执行范围由正式JSON、用例和私网身份原件证明。

[CI 38687044474](https://github.com/zhao-yc/DBArk/actions/runs/38687044474)固定上述SHA，当前类型与单元任务已成功，Windows x64、macOS x64、macOS arm64仍在进行；源码与真实安装须分别据最终日志核验。本机构建未签名，后续原生成功也不能外推macOS私网实库。

## 尚未覆盖

这里只完成普通查询块的首批输出别名路径。祖先输出别名在特定标量子查询中的可见性、完整窗口/LATERAL/例程局部名、复杂集合括号恢复及其它方言仍待做；不能把最近查询块隔离当作完整作用域。本机安装实库仅当前13384的32项范围，不是全部146项；当前原生矩阵、其它安装实库组合和公开资产仍待验证。上一检查点 e9ed54d 的三平台成功不能替代它。Q01仍为部分。
