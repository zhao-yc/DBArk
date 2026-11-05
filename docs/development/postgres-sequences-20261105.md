# PostgreSQL 序列浏览与创建

选择 PostgreSQL 数据库后，可以从对象树打开序列，也可通过「其他 → 序列」浏览。详情显示类型、起始值、增量、上下限、缓存、循环、注释和所属字段，标识列归属会单独标记。

「目录记录值」来自 `pg_sequences`，可能包含已分配的缓存值。序列尚未分配或当前角色没有读取目录值的权限时，会显示相应提示。打开和刷新详情不会推进序列。[PostgreSQL pg_sequences](https://www.postgresql.org/docs/18/view-pg-sequences.html)

在数据库右键菜单或序列列表点「新建 PostgreSQL 序列」。选择 schema 和整数类型，填写名称及可选参数。留空使用 PostgreSQL 的升序或降序默认值。预览显示精确整数和完整 SQL。确认后在同一事务内创建、写注释并回读参数，成功后自动打开详情。此入口创建独立永久序列。[PostgreSQL CREATE SEQUENCE](https://www.postgresql.org/docs/18/sql-createsequence.html)

## 验证

- macOS 上 Node.js 24.17.0 运行时检查、类型检查和源码构建通过。
- macOS 完整单元回归共 1,326 个文件，27,451 项通过，10 项 Windows 系统 tar 用例跳过。
- Server-200 独占 PostgreSQL 18 实库回归 5 项通过。验证 64 位整数与降序默认值、无效步长与越界拒绝、预览零写入、一次性提交、注释和标识列归属，以及无权限、仅 `UPDATE`、具有 `USAGE` 三种状态下的可见性。
- 首轮原生测试按部分名称定位新表，同时匹配了新增的标识序列目录项。将断言收紧为全限定表名后复跑，首轮独占容器已停止并保留诊断。
- macOS Electron 原生场景通过，记录 45 项观察。验证数据库右键新建、精确 SQL 预览、自动打开详情，以及从对象树和序列列表重新打开。独立回读确认起始值为 `9223372036854775806`，`is_called` 为 `false`。
- 两轮通过的实库与原生回归均复核原表数据和零剩余连接，并清理独占容器。Windows 虚拟机连接不可用，本轮在 macOS 接续。Windows、两平台安装包和较早 PostgreSQL 版本待验证。
