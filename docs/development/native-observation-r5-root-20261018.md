# 第五轮原生检查：模块加载失败

固定新普通克隆检查点 `2ca278db1da956d09782e0223234d7cbf4c66746`，对应源 `76b0152434e749d288506e755feb0ecd8716e1c2`。[运行 39113054046](https://github.com/zhao-yc/DBArk/actions/runs/39113054046) 已失败终止，未重跑第四轮，未发布产品。此前源码、测试及独审准备见[第四轮之后的整合](native-observation-r4-root-20261018.md)。

Linux job `117633060888` 的完整检查为 504 文件／9249 通过／10 条件跳过，类型及构建成功。Windows `117633061089`、macOS arm64 `117633061119`、macOS x64 `117633061078` 均在源码缩进专项失败，后续分栏、legacy、打包和安装未执行，不能据此扩展任何平台通过数。

## 原失败事实

三份实际报告都在顶层 errors 记录 `SyntaxError: Cannot use 'import.meta' outside a module`，随后 `No tests found`；suites 为空，没有已运行用例结果。原栈经过 `editor-native-startup-diagnostics.ts:3` 导入，固定源码 `editor-native-startup-wire.ts:17` 的 `createRequire(import.meta.url)` 与当前 Playwright CommonJS 加载方式不兼容。源码 SHA-256 为 `700608c4b03b900442469a338cead77d35487c9746661cceb31ed5366d423f8d`；依赖解析锚点的最小修复继续。

冻结 R5 读取器完整保留原错误及栈摘要；三份标记覆盖均为 missing，不能写成运行期收集失败。归档文本未见 Canceled，但未收集到用例，因此不能证明旧高亮取消错误消失，也不能用于分析原先 Mac 安装启动阻塞。

## 原件与独立读取

| 平台 | Artifact | 字节 | SHA-256 |
| --- | --- | --- | --- |
| Windows | 12131905115 | 21119 | b91d3dc7405284bce30bbd224db8ebc685bcb10bbd42a045a62d98a5666ad15b |
| macOS arm64 | 12131451306 | 21166 | 0f8b90083c3c2f37fb2868cf1793e25b509e5e3b1f3f57e36d8d53706af8831a |
| macOS x64 | 12131206580 | 21163 | 0ccf8def0eec98922d14815b55ba157df985df20f65f02f5a06a362e1f6ce5a1 |

连接器元数据核对 run／head／artifact 后，Root 从无回显原始标准输入接收内存下载地址，不进入命令参数、环境、文件或错误消息。三份均完成网络摘要及落盘重读验证；员工先前 DNS／内存管道失败与 Root 的 arm64 输入超时原记录保留，没有覆盖或自动重试旧目录，也没有把地址放入命令行。

员工独立安全提取：每份 14 条目，CRC、路径及预算均核，只提取文本；R5 固定绑定和读取器接纳全部三份，原顶层错误逐字摘要保留。交接 SHA-256：`68ba0532145c89b6c0ebc11a78debff382a039e693bfc052e7f8fe908efe6039`。

Root 又使用 Python 标准库独立核原 ZIP 大小／SHA、共 42 项 CRC、全部文本摘要及空 suites／两条顶层错误；证据 SHA-256：`8b91d40e774d4e66e2ef987587456674a5167eb17d2d29a5fb656f63c8d07174`。同一冻结读取器 `602098da2938bd0b260e80662df556f16bd95a3359ba9e848975d282c946bf84` 重读三份，与独立输出逐字相等，回执 `00803d5ba61f46ed7f20b020bd65438ef40cf3378da875c75c9830f5a932c366`。数据读取接纳不等于原生验收通过。

本轮没有执行下载附件、本机 GUI、数据库、SSH、Docker 或剪贴板。当前仍为 0.23 独立诊断，不作为 0.28、安装或公开发行的通过证明。下一轮需先修复并通过正式转换器模块加载，再使用新的检查点及绑定，原 R4／R5 原件继续保留。
