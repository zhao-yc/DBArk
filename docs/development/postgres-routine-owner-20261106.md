# PostgreSQL 函数和过程所有者转移

从对象树或工具栏「函数」列表打开目标重载的定义，选择「转移例程所有者」。按角色名称搜索，从候选中选择新所有者。预览会展示完整输入签名和新角色。核对后勾选确认，再点击「确认转移所有者」。目录会刷新，当前角色失去读取权限的重载会从列表移除。

普通用户的候选角色须可通过 `SET ROLE` 切换，并在原 schema 具备 `CREATE` 权限。对于 `SECURITY DEFINER` 例程，转移后会以新所有者的权限执行。PostgreSQL 会按其规则调整授权记录中的所有者角色引用。[PostgreSQL ALTER FUNCTION](https://www.postgresql.org/docs/18/sql-alterfunction.html) · [PostgreSQL ALTER PROCEDURE](https://www.postgresql.org/docs/18/sql-alterprocedure.html)

候选与预览只读目录。预览中的首条同所有者语句用于在确认时锁定原例程。随后按目标角色 OID、名称和权限复核，并在同一事务中核对实际所有者、授权、正文、注释和出向依赖。目标角色或原对象变化时，旧预览无法提交。

## 验证

- macOS 上 Node.js 24.17.0 运行时检查、类型检查和源码构建通过。
- macOS 完整单元回归共 1,326 个文件，27,455 项通过，10 项 Windows 系统 tar 用例跳过。
- Server-200 独占 PostgreSQL 18 实库回归 5 项通过。覆盖按角色权限搜索、原角色失去可见性、同名重载互不影响、目标角色撤销 CREATE 权限后旧预览回滚、OID 和注释保留、原授权引用迁移、定义者实际运行身份和过程 OUT 参数。
- macOS 原生窗口回归通过，共 62 项观察。覆盖搜索变化后清空旧选择、定义者身份提示、确认门槛、按重载转移和对象树及函数列表刷新。独立连接核对 OID、注释、新旧角色权限、定义者实际运行身份、零剩余连接和成功轮次的资源清理。
- Windows 测试虚拟机不可达，本轮切换到 macOS。Windows、两平台安装包和较早 PostgreSQL 版本待验证。
