# Windows源码：多值筛选增量验收

## 固定来源与入口

WIN11-TEST的“dbark测试”会话在原普通克隆、原测试分支快进到 `ac629f356d79bbce0b4ff902dc7aaf565b60858f`，源码树 `6f3975c0fedb24a9268750a8506c59a373976206`。与Linux已验9b06ef1相比只有Markdown差异，运行源码、测试、依赖、脚本及构建配置一致。本次重新构建，不复用3a85b58产物；后续仅文档交付不改变这些输入。

原入口 `tests/e2e/query-result-organize.spec.ts` 在MySQL 8.4.11／200的13384隔离实例执行原三行常量查询。保持原120秒、单worker、零重试、原审计及严格资源收尾断言。增加文本成员、精确BIGINT成员、DECIMAL反列表三组真实面板操作，原排序、七文本条件、区间、颠倒端点、空结果及文件断言保留。

## 实际结果

| 层级 | 本轮结果 |
| --- | --- |
| 类型／定向／新构建 | 入口退出0、88.34秒；类型35.53秒、7文件313项全部通过（阶段8.64秒）、构建44.16秒；109份新构建文件 |
| 实库Electron整例 | 1个复合用例通过，0失败／跳过／重试；退出0、外部16.847秒、正文14.334秒 |
| 文件独立读回 | Python标准库通过，CSV 177字节、JSON 321字节；行1／3、六列顺序、精确BIGINT／DECIMAL、NULL／空串／BLOB及隐藏列排除一致 |
| 完整Windows单元 | 576文件、11045通过、1原有POSIX条件跳过、0失败；退出0、380.308秒，自然结束，无重跑 |
| Linux独立CI | [39383704157首次运行](https://github.com/zhao-yc/DBArk/actions/runs/39383704157)，固定9b06ef1，类型／576文件／11036通过／10原win32条件跳过／构建成功；不算桌面实库 |

原用例确认owner正常退出、observer同流关闭、一次业务查询／两导出任务完成、pending／revision为0及历史不变。最终Git干净、本克隆和本轮准确PID均无所属进程，109份构建哈希不变。任务ID及owner nonce未单独序列化，不从目录随机标识推断owner。凭据仅在本轮子进程内存，提取前后逐命令核对Server-200及当前root Unix socket；没有创建或修改Docker／数据库资源。

## 原件与未验范围

VM原件目录 `outputs\query-result-list-ac629f3-vm-20261020`，32项清单已在VM核对。开发会话读取原报告输出与清单值，未下载独立复算以下原件：

| 原件 | VM报告SHA256 |
| --- | --- |
| list-filter-result.json | 33815aa121b827c4e9f0d38cd3cdb508b81017bf1fcfc8c2734508cc2a895b05 |
| list-native/native-original.json | 954a5dd4e0575a60609c12c07d53aedb4c5d5516beed4fd93766fabb2d64d3b9 |
| full-unit-original.json | 8afa3c70968e2e8748afeb79aed1b6b1fee7d45f479464b4e3f7caba8a7830aa |

独立读回CSV SHA256 `a8d7e0d2949aec1d5ba342b1cd6bb9c30d98901c1edacbb17fc021c5a8cf9048`，JSON为 `fd0979ab54e513de5b565d11a2dfa1174cccc4b18393a8d338b813c26aeb4678`。原两轮GUI失败及未确认严格退出记录保持，五批历史原件校验一致。

文件框回答仍由准确替代答案提供，复制使用合成ClipboardEvent；不算系统文件框、剪贴板或输入验证。未验日期时间成员GUI、其它数据库版本、安装包、macOS及本机Navicat二进制行为。main同次原生CI的Mac arm64几何失败[单独保留](../../docs/development/query-result-vm-main-handoff-20261020.md)，不被本Windows结果覆盖。本批交付源码，暂不发布，不增加完整工作包及公开发行计数。
