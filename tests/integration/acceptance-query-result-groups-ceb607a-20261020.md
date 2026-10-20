# Windows源码：嵌套分组筛选验收

## 固定来源

WIN11-TEST的“dbark测试”在原普通克隆及原测试分支验证 `ceb607a98c6c8d0c8743e040db0a60a5f40b6713`，源码树 `347c689559997961853b861a467cacbfff261c53`。与b72df26相比只补原生最终分组后复制／导出步骤及说明；0579316仅更新文档，运行源码、测试、依赖、脚本及构建配置与ceb607a一致。本批交付该产品及验收文档，不混入后续Mac显示租约脚本候选，不发布。

入口为原 `tests/e2e/query-result-organize.spec.ts`，原120秒、单worker、零重试、三行常量SQL及审计不变。在200／13384的MySQL 8.4.11验证OR子组配AND根、三层混合及分组重开；最后保留原金额条件并增加OR子组，原复制和两格式导出直接消费该分组视图。没有创建数据库、表、用户或变更权限。

## 本轮实际结果

| 层级 | 实际事实 |
| --- | --- |
| 类型、定向、新构建 | 退出0；外部108.82秒，入口自报108.72秒；类型37.72秒、8文件329项全部通过（阶段13.36秒／报告11.32秒）、构建57.63秒；109份新构建文件 |
| 实库Electron整例 | 1个复合用例通过，0失败／跳过／重试；退出0、外部36.815秒、正文30.414秒 |
| 文件独立读回 | Python标准库通过；CSV 177字节、JSON 321字节，行1／3、六列序、精确整数／小数、NULL／空串／BLOB及隐藏列排除一致 |
| 完整Windows单元 | 577文件、11061通过、1原有POSIX条件跳过、0失败；退出0，359.647秒，原进程自然结束，无重跑 |
| 独立Linux CI | [39389431535首次运行](https://github.com/zhao-yc/DBArk/actions/runs/39389431535)准确ceb607a；类型／577文件／11052通过／10原win32条件跳过／构建成功，223.21秒；不算桌面实库 |

原用例确认owner正常退出、observer同流关闭、一次业务查询／两导出准确完成及pending／revision为0、历史不变。最终Git干净、仅本克隆及本轮准确PID核对无残留，109份构建哈希不变；taskId及owner nonce未序列化，不从输出目录标识推断owner。凭据只在受控内存给原子进程，未更改父环境或保存密码。六批旧报告清单均一致，旧失败和未确认严格退出记录保持。

## 原件与边界

VM原件位于 `outputs\query-result-groups-ceb607a-vm-20261020`，33项清单已在VM复核。开发会话读取原输出及完成结果，未下载以下原件独立复算：

| 原件 | VM报告SHA256 |
| --- | --- |
| groups-filter-result.json | 27c31c301a332e3deec8e071d0440d74cfee2df30e17e50d9fa904f0972211d1 |
| groups-native/native-original.json | c3fabbc960404d62558c8c130d24963ffab57efeab47104238c6d40fdc0c5de4 |
| full-unit-original.json | 0b0ad9138962f1ff483a6a7974517ce6ceec86e4fad9737e100ba54efa2d4757 |

CSV SHA256为 `a8d7e0d2949aec1d5ba342b1cd6bb9c30d98901c1edacbb17fc021c5a8cf9048`；JSON为 `fd0979ab54e513de5b565d11a2dfa1174cccc4b18393a8d338b813c26aeb4678`。不以相同内容摘要替代本轮实际读回或其他规模验收。

文件框回答仍是准确替代答案，复制为合成ClipboardEvent，不算系统文件框、剪贴板或系统输入。未验日期时间分组GUI、其他数据库版本、新安装包及macOS；main两轮Mac几何失败单独保留。不增加完整Navicat工作包或公开发行计数。
