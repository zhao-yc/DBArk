# 同库复制结构及数据：首批 Windows 源码实证

本记录限定 MySQL 8.4.11/Linux/plain、同库普通 InnoDB 的空表与精度表两个界面场景。来源为 `567b6a7a45090ffbf76c759c000eac6f8ff8f488`，产品和108份构建文件逐SHA沿用 `0fb9f324b77a0496b64e05fb2c90970b01c12c95`；后者完整6859项单元、类型和构建通过，前者另有208项定向及类型通过。不把后续源码、R93安装或其它驱动混入本批。

## 实际流程与结果

`run1351` 的 `copy-data` 是完整阶段：empty和precision两个完整 file/titlePath/projectName 身份均单次 passed，零skip、retry、unexpected、flaky及报告错误，原阶段退出0，合计16324.33毫秒。使用正式Windows开发Electron，按原每项120秒、单worker、零重试执行。

通过真实只读预览、准确名称与风险确认后单次创建及服务端 `INSERT SELECT`。精度场景逐字段验证大整数、DECIMAL、NULL、空字符串、空字节和非文本二进制；目标行与来源一致，来源定义和数据保持，目标自增列及零值按原场景断言核验。数据不为复制而整表拉入客户端。

前 `run1350`、后 `run1352` 六实例相关临时库、用户和线程均零；Data阶段结束的有效原生枚举为正数，所属进程零。该阶段没有系统剪贴板操作、Docker、新用户或权限授予。

同一计划后续Maria10.11在DDL前的测试模式白名单失败，Maria11.4未执行，因此整个 `run1351` 仍为失败。本记录只接纳完整Data阶段两项，不改写整批接纳，也不增加固定R93安装的215个身份。

## 原失败与修正

`run1339` 原为空表1pass、精度观察断言1fail。观察查询对 `CAST(id AS CHAR) AS id` 使用未限定的 `ORDER BY id`，按输出文字别名排序；精度场景尚未执行产品复制。修正仅明确引用基表的BIGINT列，CAST/HEX投影与原期望保持，不经JS Number重排或舍入。名称解析依据见[MySQL SELECT](https://dev.mysql.com/doc/refman/8.4/en/select.html)。

原失败及检查退出保持；`run1354` 在完整定义、行摘要和精确本地归属复核后恢复该单例，库和owned目录删除、原件摘要不变，随后六资源零。`run1351` 是修复后的新编号执行，没有改写或重新使用旧入口。

## 独立采证与范围

独采核对1515份固定Git源码、108份dist和9份controls；423份产品源码与0fb完整基线一致。读取的1649份公开原件末尾摘要不变。交接SHA256为 `3e617803e4706edadc2c13b660cd85760710ffc702813eb46664b336259446c4`；原件位于Root的 `.cache/parallel-20261015/employee3-table-drop-owner-20261017/.cache/review1351-source-preparation-20261017/`，不提交日志、凭据或测试行。

复制按独立READ COMMITTED会话执行，预览不固定随后数据快照，DDL与数据提交不原子；未知结果保留目标，不自动重放或补DROP。未验完整版本/类型、百万行复制、各阶段取消与断线、锁等待/释放、同名替换、权限/模式漂移、安装及macOS。具体限制见[实现说明](../../docs/table-copy-data-20261017.md)，公开版仍为0.20.0。
