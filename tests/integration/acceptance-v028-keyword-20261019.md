# 冻结0.28关键字专项：Windows闭环，Mac源码失败

固定产品`bf08645`，实际测试头`eb171c2aea239f10ab170cbc8f47318fa12bbe64`，[原运行39265643127](https://github.com/zhao-yc/DBArk/actions/runs/39265643127)整体失败。Windows job118104387550成功；Mac arm64 job118104387921失败。两个平台以`max-parallel:1`串行，未重跑已闭合的六项原生专项或普通legacy。

新job先通过GitHub官方API核原artifact归属、原始ZIP长度/SHA256/全部CRC，再同次typecheck/build，比较新源码清单113个运行文件与原批准的全部相对文件及SHA。Windows再固定安装前119文件旧参照与原NSIS摘要，实际安装后逐文件比较完整119清单，创建本job新批准；原绝对路径与旧批准上下文不移植为新批准。Mac源码113字节同样一致，但源码失败后安装阶段停链。

## Windows实际结果

源码/实际安装各运行原upper、lower两例，0跳过、0重试，共8个owner正常退出。各例保留默认/两种大小写、真实Monaco格式化快捷键和单次Undo/Redo、实际file模块迟到撤销、SQLite9、独立重启的活动ID/唯一可见pane/模型/正文，资料目录成功清理。

四个例的模块终态均为held1、delivered1、detached true、failed false、contextRoundTrip true；每例两正常owner，记录PID数量分别6和5。没有SQL执行或系统剪贴板访问；这些CDP格式化快捷键不算系统Ctrl+S。

安装器沿用原成功候选`DBArk-0.28.0-win-x64-unsigned.exe`，142664620字节、SHA256 `9b98642db34cee99453e671e23f78af11821ae6314e51fbd39ffc718754d62fe`。仅在干净新CI实际NSIS安装，两例及四owner全部成功后，规范卸载并核注册归零、临时根清理。没有覆盖本机用户安装。

| 原件 | 源码 | 实际安装 |
| --- | --- | --- |
| 批准SHA256 | `52fe912e8028cdbab0c525d93aefd0b538bd6e73d0d7ed22545d31852672d1aa` | `c42ef3c9e8a33527d7fb12d89eceb9e9d9e5b9ea3271ebac38df90e868cec249` |
| 独立关键字清单SHA256 | `8bed67d2069fa4a2f64ff3dcd32e7b9ac424e9c45ee3f3428f1f2463e85157a5`（113文件） | `df048e9584752aadfa3674932d2d13b1cba5ca5271ea4c78cf48c8670cb6d083`（119文件） |
| 原报告SHA256 | `0cec6c67548d116f91f226592417dd86739588a77fd4f55e86c0c1eb333fbc93` | `2f94bbc7a5761f866f480a1933023e1bea482a306a8414e22690e6e36ba8f2d0` |
| 精确receipt SHA256 | `041df3722973486a7a3d25dddf322024d43419add1c3101cf46fe6407d9a3e6e` | `c18a827f848c51d1d6e9b004d78f91f62384dcac55c4d7cd7e6adefa0e4ba268` |

安装清单绝对根不同，所以清单SHA与原4a清单不同；原119个相对文件及内容摘要完全匹配。源码113清单甚至与原4a清单SHA完全相同。该结论不是只看src tree或程序版本号。

## Mac arm64原失败

新源码批准SHA256 `d519d90c2bf0deaca5625a20888bb787b08b0ed34b5a5232bf526dacd6dc724d`，113文件清单SHA256 `9077db7bfdc21b14ddd6db8004efebc096eb9d5108be8b050ff55e55be9be12a`，与已核原六项/普通回归运行字节一致。原报告SHA256 `8dc14b60b5bc28d0a06e4a72de40bf0795999047bbc4b0227f15739f7ca28ebe`。

upper例在独立重启后，通过持久化活动ID和实际唯一可见pane/模型/正文断言，再经原键盘写入混合大小写样例。第183行再次格式化调用的原第103行5秒正文断言失败：预期SELECT/AS/FROM/WHERE大写，实际仍为原混合大小写。用例耗时约28.4秒，未达到120秒总期限；不延长原5秒或总期限。此前步骤未单独签发成功终态，不能将它们分拆成完整通过。

lower例因串行首例失败未运行，原JSON stats为expected0、unexpected1、skipped1、flaky0。安装阶段未执行。失败目录`/private/var/folders/n6/hn37q6pj7sj_9dmqqc2113800000gn/T/dbark-indent-NRAJM9`保持：首owner正常，第二owner confirmed/willQuit/closed均false，原记录PID2777/2781/2782/2783，目录未删除。没有访问旧VM、补强停、补查SDK或补清理。

根因尚未确认，当前不能区分产品问题、启动时序或快捷键接纳问题。原附件未提供足以确认这些原因的独立事实，不能凭推测修改测试或冻结产品后重跑。此项明确阻断当前关键字跨平台闭环，不由原六项/legacy绿色覆盖。

## 独立只读回读

第一次原报告回读39266771848/job118108277838已核两归档SHA/CRC与Windows原footer、Mac失败原件。加强回读[39267183253](https://github.com/zhao-yc/DBArk/actions/runs/39267183253)/job118109711603，头`02e69f8748820cb5124fb907f51a688683b1466d`，再次只读核完整119安装参照、Mac新批准/113清单及所有原报告身份；没有运行产品或重试原用例。

| 原归档 | 字节 | 独立接收SHA256与全部CRC |
| --- | ---: | --- |
| Windows artifact12193651442 | 73725 | `e734d623ff5b18c66cb27141ac2e5f7b41cc22de041ec3ae200faa947e269d9e`；通过 |
| Mac失败 artifact12192148660 | 44098 | `24105dab20523d3dc0256e09a8f08b6d4f873796f14f1102ab327c2b070c8e02`；通过 |

校验宿主为GitHub-hosted Ubuntu。本机仅保留连接器解码归一日志与提取receipt，不称本机ZIP已核；回读副本artifact12192478934（196409字节，API digest `884d0eabd0d036a4a84fd08fb43aa460c6884b31c34821d523122b5b04d18726`）未独立再下载。机器清单见[关键字证据](../../docs/releases/v0.28.0-keyword-evidence.json)。

本地新增消费者12个反例/正例与门23项通过；旧固定角色夹具在同组运行时静态扫描发生一次5秒超时，原输出保留，单独执行原20项在原期限内全部通过，没有修改期限。类型/脚本语法/YAML/差异检查通过；固定eb171c2完整Linux563文件、10680通过/10跳过、类型/构建成功。完整CI不代替上述Mac失败。
