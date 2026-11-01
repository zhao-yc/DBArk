# SQLite 原字节读取接入实际 worker

## 行为与边界

任意 SQLite 查询改用自研 `nativeRows.c`，在原连接只准备、执行一次原 SQL。结果按真实 INTEGER、REAL、TEXT、BLOB、NULL 解码；严格校验 UTF-8／UTF-16LE／UTF-16BE，保留合法 U+FFFD、BOM、NUL 和整数精度。坏 TEXT 报 `SQLITE_TEXT_ENCODING_UNREPRESENTABLE`，不以替换字符掩盖，也不重跑查询。

已发送批次可以保留，失败不冒称整句完成。`RETURNING` 报错不代表写入没有发生；自动提交和显式事务分别报告原事实，不自动回滚或重放。累计行数／字节预算、公有 IPC ACK、原生强取消及只读／创建 authorizer 继续使用原协议。达到显示预算仍消费原语句；被丢弃的结果也进行编码校验。

## 固定资源与构建

`node scripts/build-sqlite-native.mjs` 单独构建；`pnpm dev`、`pnpm build` 和 Vitest 准备阶段复用它。固定 SDK 头文件按 SHA256 校验，Windows 自动准备项目内固定 Zig 编译器，macOS 使用系统 `cc`，生成双架构、临时签名 dylib；不安装系统服务。首次构建需要网络与相应编译工具。

资源位于源码 `src/engine/sqlite/sqlite-native/` 和构建 `dist/main/sqlite-native/`，均为忽略产物。文件名绑定内容摘要，清单限定平台、架构、字节数与摘要。运行时只从对应固定目录读取；asar 映射到 `app.asar.unpacked`，拒绝文件链接和逃逸路径。清单校验用于检查资源完整性，不代替应用签名。

每连接仅启动时加载自研库，立即关闭扩展加载；用户 SQL 不能调用私有控制函数。macOS 仅 SQLite utility 使用允许加载开发库的 Plugin helper，渲染层沙箱和上下文隔离保持。打包保留库的临时签名，正式证书签名仍需另验。

## 本轮证据

- Windows 本机：类型检查、构建通过；190 份相关文件、3783 项测试通过，包含三编码坏文本、原生权限、累计预算、强取消、写入及事务事实。
- 随后增加 1 项构建资源专项并通过：相同摘要文件不被重复覆盖，损坏文件拒绝并原样保留。
- 实际 Electron 源码工作区：1 项通过，两个准确进程均正常退出 0，同 profile 重启仅恢复草稿，独立磁盘读回确认回滚和提交；临时资源核零，未访问系统剪贴板。原件在忽略目录 `.cache/sqlite-raw-core-20261102/` 及 `test-results/sqlite-workspace/`。
- Windows 未安装开发包：`electron-builder --dir --win --x64 --publish never` 产物的同一工作区原例通过。已独立核对主进程、preload、SQLite worker 与构建逐字节一致，原生清单与库摘要吻合；两个 asar worker owner 正常退出，临时 profile 核零。未执行安装／升级。首轮验收脚本导入路径错误，应用未启动；修正后单次运行通过，原失败日志保留。
- Windows 源码追加三例分别通过：只读分页／类型筛选／多列排序、完整四格式流式导出、表格增改删／事务提交／并发冲突整批回滚。三例串行，沿用原 120 秒、单 worker、零重试和断言；逐例原回执及临时目录核零独立检查。首轮批命令重定向路径含 NUL，未启动用例；修正命令后执行，未改 spec。
- WIN11-TEST 会话不可达，本轮按既有授权本机接续，未重复派发。无 Server-200、Docker、真实数据库或已安装客户端配置操作。

上述不代表全量功能、安装升级、Mac 客户端或性能验收。打包及三平台 CI 独立记录；此前独立探针失败与并发回归失败保留，不追认。暂不创建 Release。
