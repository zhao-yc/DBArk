# 0.18 表重命名产品切片与待验清单

本切片从固定基线 `cae5a4f840177e74a91bd255f5629bd56ce6140d` 开发，分支 `codex/employee1-table-rename-20261016`。它提供同库普通表重命名专用面板，不代表完整O01，也不代表六实例或原生安装验收通过。

## 最小契约

| 动作 | 客户端输入 | 可信服务行为与输出 |
| --- | --- | --- |
| `schema.tableRename.get` | connectionId、database、table、taskId | 读取完整SHOW CREATE、原生TABLE_ID、实际模式、服务器身份、目录属性、权限与依赖；返回限时snapshotId、ddlHash、原生编号、可写性和只读原因 |
| `schema.tableRename.preview` | snapshotId、newName、taskId | 新名称不含数据库；重新读取并严格比较原快照，核对实际表/视图名称占用和目标DDL权限；只生成固定单条RENAME SQL及一次性previewToken |
| `schema.tableRename.apply` | previewToken、三项准确风险确认、taskId | 任何等待前消费令牌；主进程注入连接revision；共同占用来源和目标；重核来源、依赖与目标冲突后只发送一条SQL |
| `schema.tableRename.release` | snapshotId或previewToken | 精确释放本用途；释放快照同时撤销全部关联预览，不释放其他编辑器令牌 |

客户端不能提供SQL、连接revision、跨库目标或物理表ID。缓存沿用共享总额和两分钟TTL。取消沿用独立结构会话：等待原命令回调/真实终态和严格连接收尾；KILL确认、本地断线及Promise失败均不等于DDL未执行。DDL结果未知、后核验失败和关闭失败不自动重放。

只有收到DDL成功响应，并在新名称读到相同TABLE_ID、除CREATE首部名称外逐字相同的完整定义、相同目录属性和模式，且确认旧名称不存在、警告数为零，才报告完整核验。并发DML改变自增计数也会保守降为未完整核验。

## 可写范围与产品行为

- 首批为MySQL 8.0.30及以上的8.0分支和8.4分支，Linux、lower_case_table_names=0、ASCII库表名、非分区InnoDB基本表。新名称为1至64位ASCII字母/数字/下划线且首位非数字；拒绝修剪、截断、自动加后缀或拆分库名。
- 原生身份沿用现有完整结构读取器；该读取器未能证明的默认值、物理引擎注释选项、表尾、编码目录等范围也保持只读，不因为RENAME语句短而放宽来源证明。
- 先证明直接全局SELECT、SHOW VIEW、TRIGGER目录可见性和精确来源/目标DDL权限，再读取InnoDB全局外键目录、触发器目录与VIEW_TABLE_USAGE。已知入向/出向外键、触发器、视图引用、CHECK约束均只读。PROCESS实际目录权限仍由原生身份/外键读取确认。角色、部分撤销及未知目录不能被空结果伪装成无依赖。
- 对象树和表页提供专用入口。来源和目标名称的全部隐藏表页均检查活动任务、未提交数据及列布局草稿；已有模态不叠加。列布局使用工作区独立tableLayoutDrafts标记，不改写数据草稿或退出流程。SQL预览只读，三项风险必须准确匹配。
- 完整核验后关闭原名及新名的干净旧标签，用全新标签ID重读新名称；不把旧组件直接换成新目标。按精确连接和数据库通知对象树实际调用metadata.objects，使用请求代次、卸载和连接修订围栏拒绝旧目录回填。
- 只在完整核验后迁移精确表收藏，保留自定义标签；新名称已收藏或保存失败时保留原配置并明确提示人工处理。当前窗口停用原名收藏/链接，并撤销迟到导航。结果未知时来源/新名表页标为过期，刷新目录供人工核对，不自动认定成功。
- 查询标签与保存的SQL不改写。已复制URI是名称链接，不自动重定向；当前窗口的旧名停用表不跨重启持久化，外部名称复用、跨重启身份保障和链接升级另列后续工作。

跨库移动、多表交换、依赖重构、自动授权迁移、存储程序/事件/外部应用引用修复、MariaDB/MySQL5.7/其他版本、其他引擎、分区及未知名称映射均未交付。存储程序、事件、外部程序及名称链接需人工检查，作为第三项明确风险确认；本切片不声称遍历了外部引用。

## 官方语义依据（2026-10-16核对）

- [MySQL RENAME TABLE](https://dev.mysql.com/doc/refman/8.4/en/rename-table.html)：来源需要ALTER/DROP，目标需要CREATE/INSERT；表级授权不会迁移；FK和CHECK自动命名可能随名称调整。本切片拒绝相应约束以保持严格完整定义后核验。
- [MySQL隐式提交](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html)：RENAME TABLE属于隐式提交DDL，不能依靠事务回滚撤销。
- [MySQL元数据可见性](https://dev.mysql.com/doc/refman/8.4/en/information-schema-introduction.html)与[VIEW_TABLE_USAGE](https://dev.mysql.com/doc/refman/8.4/en/information-schema-view-table-usage-table.html)：目录受对象权限过滤；不能仅凭空结果断言无依赖。
- [MySQL INNODB_FOREIGN](https://dev.mysql.com/doc/refman/8.4/en/information-schema-innodb-foreign-table.html)与[TRIGGERS](https://dev.mysql.com/doc/refman/8.4/en/information-schema-triggers-table.html)：分别核对原生两侧路径及触发器可见范围。
- [MariaDB RENAME TABLE](https://mariadb.com/docs/server/reference/sql-statements/data-definition/rename-table)：虽然有自身原子DDL支持，不能据此假定与MySQL依赖目录及完整定义语义相同；当前只读。

## 本分支验证与实际命令

当前只完成纯单元、类型检查、构建与默认关闭准备；没有使用GUI、200、剪贴板或Docker，没有生产操作。

使用已安装Node依赖直接运行以下命令。最初尝试`pnpm typecheck`时Corepack试图下载指定pnpm，但网络解析失败；后续未安装或修改依赖、锁文件。

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
node node_modules/vitest/vitest.mjs run tests/unit/engine-table-rename.test.ts tests/unit/main-table-rename.test.ts tests/unit/table-rename.test.ts tests/unit/table-rename-tree-refresh.test.ts tests/unit/ui-workbench-navigation.test.ts tests/unit/engine-table-comment.test.ts tests/unit/main-table-comment.test.ts tests/unit/table-comment-ui.test.ts tests/unit/engine-table-default-encoding.test.ts tests/unit/main-table-default-encoding.test.ts tests/unit/engine-structure-late-cancel.test.ts
```

最终结果：上述11文件139项通过；补充工作区、列偏好与布局SQLite回归3文件18项通过，合计14文件157项；类型检查和构建通过。构建仅有既有依赖注释/大块体积提示。本文件不把驱动替身算作服务器验收。纯测试执行真实Engine、生产主进程dispatch/退出函数、数据库节点和导航逻辑，仅替换驱动、React调度及IPC边界。

补充布局SQLite组在Windows沙箱默认TEMP下曾有8项因原子rename的EPERM失败，原日志保留在`.cache/table-rename-layout-regression.log`；把本轮TEMP/TMP显式限定到员工1克隆内`.cache/table-rename-test-tmp`后，同组三文件18项全部通过，没有修改产品存储实现来规避失败。最终日志为`.cache/table-rename-layout-regression-workspace-temp.log`。其他最终日志为`.cache/table-rename-unit.log`、`.cache/table-rename-typecheck.log`和`.cache/table-rename-build.log`，均不提交。

## 默认关闭的核心/UI准备

- 核心：`tests/integration/engine-table-rename.integration.test.ts`，6例，默认全部跳过；必须同时显式设置`DBARK_INTEGRATION_ENABLED=1`及`DBARK_TABLE_RENAME_TEST=1`。
- 正式Electron：`tests/e2e/table-rename.spec.ts`，3例，同样默认关闭；本轮只用`--list`收集，不启动Electron。需要ROOT集成侧栏正常流布局修复后运行，禁止force click绕过名称遮挡。
- 两入口均使用`tests/helpers/tableRenameTarget.ts`：目标必须显式为已核对200六实例之一；13484必须严格TLS和同一已有CA，不降级；账号显式注入，不创建账号或证书。
- 核心准备包括复杂定义/数据保持、真实冲突、同定义重建TABLE_ID变化、连接revision变化、依赖只读、真实MDL等待取消，以及本轮库/线程清理。MySQL5.7与两种MariaDB端口只验当前只读边界。
- UI准备包括正常点击两个入口、只读SQL、双击一次、新标签重读、真实冲突、返回编辑释放旧预览与风险确认。隐藏页保护、旧导航/目录迟到、收藏迁移已做纯测试，完整原生交互仍待ROOT补验。

未来获授权后由ROOT在固定集成提交上逐实例运行，分别记录版本、端口、TLS、SQL、真实TABLE_ID、原定义/数据、取消进度、独立观察结果、线程与隔离库清理。员工1本轮不执行这些网络或GUI操作。共享契约接线涉及commands/contracts/validation、main/engine、App/Sidebar/TableTab；ROOT负责最终汇合，未改styles.css或覆盖ROOT布局修复。
