# MariaDB 跨页删除：备份锁候选与失效反例

## 结论与产品状态

本轮没有开放 MariaDB 的“删除服务器全部筛选行”，也没有缩减原有完整快照、可靠键、旧值校验及删除范围要求。`BACKUP STAGE BLOCK_DDL` 能阻挡正常并发 DDL，但持锁连接不能自己删除；改用独立保护连接后，两连接缺少共同的原子失效边界。两个实际实例均复现保护先消失、写事务继续存活并发生新增级联影响的服务器时序，不能仅靠心跳、异步取消或提交前复检放行。

原 MySQL 8.0.46／8.4.11 产品路径、MariaDB／MySQL5.7版本拒绝及全部源码／测试保持原字节；本轮只公开脱敏研究结论。旧版完整兼容仍未完成，不计作功能验收或工作包完成。原功能和历史失败见[删除全部筛选行](table-filtered-delete-20261026.md)。

## 官方依据与静态边界

- MariaDB 备份阶段是实例级接口，要求 RELOAD；从 START 请求 BLOCK_DDL 会经历中间阶段，涉及普通非事务表新写阻塞，不是目标表的局部锁。正常 InnoDB 提交与 BLOCK_DDL 可并行，不能将它误作 BLOCK_COMMIT。[官方阶段说明](https://mariadb.com/docs/server/reference/sql-statements/administrative-sql-statements/backup-commands/backup-stage)、[工具与版本差异](https://mariadb.com/docs/server/server-usage/backup-and-restore/mariadb-backup/mariadb-backup-and-backup-stage-commands)。
- 持有阶段的连接打开普通写表会触发保护错误；实际 errno 为4145。驱动的 MySQL 符号名称可能与 MariaDB 不对应，本轮依据数字及服务器消息核验，不把驱动 `code` 当作 MariaDB 错误宏。[官方4145说明](https://mariadb.com/docs/server/reference/error-codes/mariadb-error-codes-4100-to-4199/e4145)、[10.11保护分发](https://github.com/MariaDB/server/blob/mariadb-10.11.19/sql/sql_class.cc)。
- BACKUP命令包含隐式提交标记，不能在尚待回滚的事务前把 END 当作纯释放操作；连接真正清理时会结束自身备份保护，但客户端传输事件不等于服务器已完成清理。[10.11命令标记及分发](https://github.com/MariaDB/server/blob/mariadb-10.11.19/sql/sql_parse.cc)、[备份结束实现](https://github.com/MariaDB/server/blob/mariadb-10.11.19/sql/backup.cc)。
- 已开始 ALTER 的最终发布路径还需分别实测，不能从“新DDL阻塞”外推所有 COPY／INPLACE 时序；Galera 的暂停／恢复及不同配置分支不纳入本轮支持。[11.4备份实现](https://github.com/MariaDB/server/blob/mariadb-11.4.13/sql/backup.cc)。

## 两实例实际研究

执行前已核对 Server-200 的主机身份、两个 DBArk 专用容器归属及每条实际连接的版本、hostname、端口和 server_id。范围仅13310的MariaDB10.11.19与13311的11.4.13，GLOBAL wsrep_on 均明确OFF。每个实验使用随机自有库、父子表及少量合成行，不操作业务库，不改 GLOBAL 配置或使用 BLOCK_COMMIT。

| 场景 | 两实例分别取得的事实 |
| --- | --- |
| 同一保护连接尝试DELETE | 严格返回4145，未把其他错误或普通读失败当作有效保护 |
| 独立写事务 | 删除无引用父行后回滚保持原行；另一轮DELETE／UPDATE可明确COMMIT，独立观察读回成功 |
| 写事务提交前与提交后 | 外部明确关闭外键检查的同一ADD CASCADE均处于准确线程、准确语句的 `Waiting for backup lock`，最后由服务器返回1205 |
| 正常释放对照 | 原保护连接END后，相同目标与相同DDL立即成功，排除语句本身无效 |
| 独立保护连接丢失 | 新保护连接获得BLOCK_DDL后，写事务取得目标零行DELETE写MDL；仅KILL经过复核的本例保护线程，等待真实传输关闭及服务器线程消失，原写事务仍存活 |
| 范围扩大反例 | 外部checks=OFF新增CASCADE成功；原写事务删除1个父行，自己读到2个子行均已消失，独立观察仍见原2行。随后原ROLLBACK完整ACK，父子原值逐项恢复 |

这是确定性的服务器交错时序，不是产品取消、心跳、所有网络故障或已有ALTER的完整验收。它证明候选两连接关系自身不能提供所需保证；不能因正常锁实验通过，就把异步故障处理视作原子保护。

## 原失败、原件与收尾

初次探针将Maria布尔显示误当成字符串0：第一轮在wsrep读取处停止，未建库、未进入备份阶段；第二轮在外键检查读取处停止，已建的自有库准确清理，仍未进入备份阶段。原脚本及失败保留。后续只读采样分别确认wsrep／外键检查为OFF，事务状态仍为0／1，仅修精确表示后执行正常研究及新增故障反例，不接受任意错误或非空目录。

正常研究一轮、含故障反例研究一轮在两实例均通过，后者各6条原连接、各1次计划内自身KILL；该KILL与超时看门狗及正常QUIT分别记账，未触发看门狗，不向新保护连接发送END，也不借前一次END回执声称后者已正常释放。每条原命令等待真实回调及结束，未知时停链，不重放写入。

四轮原件、源脚本副本、命令与协议状态、原错误、文件摘要在忽略目录 `.cache/mariadb-delete-guard-20261027/`。最终另建观察连接核对原件摘要及全部准确资源：13310的4个名称／21个登记线程、13311的2个名称／11个登记线程均无库、线程或事务残留；其中第一轮名称从未创建。原连接均真实物理关闭；探针仅读取既有凭据，不写回配置或记录秘密。源码、单元、构建及安装没有因本轮重跑或追加通过计数，未发布、未建标签。

后续需寻找与写事务具有共同服务器侧生命周期的保护机制，或另行设计清晰声明参照动作影响的操作合同；不能沿用本候选直接放开版本检查。其它高频P0工作可独立推进。
