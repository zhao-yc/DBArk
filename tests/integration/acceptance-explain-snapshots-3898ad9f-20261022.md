# 执行计划快照：Windows 实库保存与独立离线重开

## 准确身份与边界

- 分支 `main`，源码提交 `3898ad9f3f2e01926eaba6f1303e2c1a216965f4`，产品树 `7c1a1bddad5eb226dde69f85624dc0f136791242`。
- 本机 Windows 源码构建，使用用户授权的虚拟机不稳定时备用环境。WIN11-TEST 旧派发在启动前被拒绝，当前仍 idle／未新执行，未重复派发，不记作 VM 通过。
- 原离线组件与两个正式 App 串行，两个 App 使用不同临时 profile。每例原120秒、零重试，原窗口／文档／配置归属及正常退出检查保持；失败保留原资源，测试开始前有前例停链门。
- 实库只读预检核对 200／13384、MySQL 8.4.11、Linux、大小写设置和准确 server UUID，原预检流正常关闭。GUI仅对公开常量 UNION 派生表执行两次 EXPLAIN（JSON、显式文本），一个会话；无业务表读写、Docker、系统剪贴板、旧窗口操作或发行。

## 正式 App 实测

第一 App 经正式连接表单和编辑器，先请求 JSON 计划并点击“保存计划快照”，再明确请求文本计划并保存。Main 审计计数 `{explains:2,sessions:1,saves:2,opens:0,dialogs:2,pending:0}`，两个已完成任务、空查询历史、零页面错误。

第二 App 没有连接或查询标签。通过主工具栏进入快照窗口，依次打开 JSON／文本快照并另存；JSON收起后查找排序标志能展开并聚焦原节点，节点完整进入视口，局部截图已核对。文本列和表格可见，原服务器来源保留；窗口无文本执行按钮、SQL编辑器或执行入口。Main 审计 `{explains:0,sessions:0,saves:2,opens:2,dialogs:4,pending:0}`，连接、任务、历史、查询标签均为空。

仅替换本例绑定窗口的原生文件选择端口，固定四个独占文件；正式 preload、Main 校验、文档绑定、磁盘 I/O、原子写入及渲染流程保留。此证据不表示人工操作系统文件选择器已验。

| 子进程 | PID | 原退出码 | 原耗时 | 结果 |
| --- | --- | --- | --- | --- |
| 原离线计划组件 | 59988 | 0 | 4.163秒 | 1通过，零失败／跳过／重试 |
| 正式 App 两例 | 62880 | 0 | 6.186秒 | 2通过，零失败／跳过／重试；框架5.613秒 |
| 初次 Python 独立读回 | 63280 | 1 | 0.113秒 | Windows跨API身份断言失败，保留 |
| 修正后的独立读回 | 71196 | 0 | 0.113秒 | 原四文件通过；未重跑GUI／重连数据库 |

## 独立读回与首次失败

Python标准库读取原始文件，不使用产品编解码器。JSON原文与唯一单元格相等，原排序／物化临时表为true，UNION临时表为false，两分支原 `dependent:false`／`cacheable:true`／select_id 2、3 保持。文本原 PRIMARY／DERIVED／UNION 行、派生表 `<derived2>`、排序提示和NULL均按原列名核对。两个另存文件分别与原文件语义及字节相等，四文件前后身份和SHA256不变。

初次独立读回失败于跨API比较 `st_ctime_ns`：Windows Python 的 lstat 报告创建时间，fstat 报告变化时间；同文件 dev／ino／size／mtime／birthtime 均相同。修正仅限忽略目录的独立读取器：跨API比较dev／ino／size／mtime／birthtime，路径对路径及句柄对句柄仍各自核对完整ctime；非Windows规则保持。33项RAM反例及编译通过后只重读原四文件，原失败日志和两版脚本保留。没有改产品、放宽文件内容断言或重跑GUI。

JSON两份SHA256：`d47ea98b333f7eb0c4e2da7c9256d27513f7b6cc434c611369f065396529434c`。

文本两份SHA256：`3229f30fb8474c5c7d1aec7820aea37bbbf4117287f7ead77a0070c450b4643b`。

## 回归与封存

最终严格类型／新构建通过；完整659文件、12938项通过，1项POSIX在Windows跳过，282.74秒，退出码0。专项编解码74、文件29、Main5、界面13、原生门18项；既有片段Main首分支及计划导航回归保持。原生默认／列表关闭通过。接近1MiB的合法文件新增解析诊断后仍以原文档精确另存；取消、错误、并发、迟到与断连保存有React／资源边界证据。

`.cache/explain-snapshots-ui-local-20261022/` 保留原GUI、初次失败与原四文件检查点；`.cache/explain-snapshot-readback-20261022/` 保留接续独立读回及合并封存。Root独立再核58份原件和2226份输入（包含构建），全部摘要与原生前后及当时当前文件一致，已知秘密扫描零命中；原计划、截图、日志不入库。

| 日志／清单 | SHA256 |
| --- | --- |
| `.cache/explain-snapshot-full-unit-20261022.log` | `962e3fbf0282c70c3545a02338d4d6c6d670b5566a5b5396787a2373f92be7cb` |
| `.cache/explain-snapshot-final-typecheck-20261022.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `.cache/explain-snapshot-build-20261022.log` | `2399771157256b6032daf0070ab5af80a7e58e3fa58e12b514364bfd99c67bde` |
| 接续目录 `manifest.json` | `f76dbd06f64df875d0a007a4197cd62047c521f7ed45535f00471c40d8073af1` |
| 修正后独立reader | `852be6c08c26f5ea691cb4f06dcb03004d6478f30a207f5b0c516154df49aa59` |

本批实际仅 Windows 源码／MySQL8.4常量整例；其它服务器版本、macOS、新安装包、人工系统文件选择器和完整Q07仍待验，不增加完整工作包或发行计数。上一源码 `87366839` CI run `39701254515` 的Windows、macOS arm64和类型单元作业已成功，Intel macOS仍执行安装阶段；这些旧候选结果不代替本批平台验收。暂不发布。
