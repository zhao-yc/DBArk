# 勾选多行复制为新增草稿

本片基于 `8ff97705152f6cd6f190f5c7d2a92930f1f3b8fb`，在普通独立克隆开发。表页新增“复制勾选记录为新增草稿”，按当前网格顺序把勾选的现有行追加到本页末尾。只暂存本地草稿，一次撤销/重做覆盖整批，保留原记录、其他草稿、原活动单元格和勾选内容。

复制沿用单行入口的类型语义：读取已暂存值，省略自增和生成列，保留非自增主键与唯一键、NULL、空串、精确数值文本、JSON原文、二进制原字节。每个字段独立深复制，副本与源行、副本之间不共享可变包装。非自增键冲突仍由原集中预览在请求前拦截，用户改键后走原 `table.preview` / `table.apply`；本入口不增加自动编号或新提交路径。

来源必须同时满足当前目标、连接版本、加载代次、完整目录身份、页面投影和原始快照对应。`TableCopySources.page` 的正常完整页在同一MDL内读取目录后只返回 `copyMetadataKey`，没有补取租约，因此不强制要求不存在的 `ready` 租约；缺目录身份、显式 `unavailable`、缺普通列、缺行、删除、新增、未知值或不完整值均整批拒绝。若页确实带租约，还须未过期、无缺列且选中行引用完整且唯一。当前引擎缺列租约不会被用于自动补取，本片不扩大INVISIBLE读取范围。

任何一行不合格都不分配新身份、不深复制、不部分追加；身份生成冲突或异常也不发布结果。全部校验后才产生临时副本，真实TableTab处理器只调用一次 `setRows`，因此形成一步历史。点击时同步复核工作区、输入、模态、页与选择引用，观察过的目标/目录变化和同一旧回调的再次调用不能复活旧操作。

预算复用 `copyInsertSqlLimits` 的1000行、1024列、50000单元格、单元格256KiB和整批1MiB。整批按待复制值及行JSON结构的UTF-8/转义成本计量，不生成SQL或整批JSON字符串；克隆前还使用原 `DraftHistory` 的同一成本函数和8MiB上限预检，保证本次操作可撤销，不让超限批次追加后才清历史。

验证限定为RAM纯逻辑和真实完整TableTab/记录控制器，保留原历史与单行用例。定向覆盖完整页无租约、未知来源/目录、混合坏行、旧回调、预算先拒、类型保真、二进制引用隔离、整批Undo/Redo及集中预览键冲突。不启动GUI、Electron、数据库、SSH、Docker、网络或系统剪贴板；没有新增IPC、依赖、存储或凭据。

实际命令（Node使用主机已有24.17.0，依赖只读复用祖先目录）：

- `node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/record-duplicate-batch.test.ts tests/unit/draft-history-table-tab.test.ts tests/unit/record-duplicate.test.ts tests/unit/record-duplicate-completeness.test.ts tests/unit/record-copy-source.test.ts tests/unit/record-copy-metadata.test.ts tests/unit/draft-history.test.ts tests/unit/paste-insert-table-tab.test.ts`
- `node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit`

上述8个定向测试文件共248项通过，类型检查退出码0。另将固定基线归档到忽略目录，仅放入同一完整组件测试夹具，保留生产源码的Git blob不变：旧18项通过，新16项因缺少批量按钮失败，退出码1；当前实现同一34项全部通过。这证明原入口缺失，不把16个缺按钮失败描述成16个独立缺陷。

未运行全套测试、build、真实桌面或服务器事务验收；RAM预览通过不代表数据库INSERT授权、跨页唯一性或原生平台已验收。后续由Root合入后在其授权窗口核对真实网格勾选、完整类型往返、拒绝批次与最终集中提交。
