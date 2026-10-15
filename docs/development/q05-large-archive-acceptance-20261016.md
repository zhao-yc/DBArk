# Q05 真实大归档边界验收入口

基线：`625ca7b0de71bc1a556335d80f838788d1793e77`。任务分支：`task/parallel-q05-archive-large-20261016`。仅新增手动验收脚本及本文，不修改产品 `src`、依赖、默认测试配置或运行依赖。

## 证明层与真实路径

本入口覆盖文件写入器、真实顺序磁盘 I/O，以及独立标准库读取 ZIP64 大文件边界。它不连接数据库，不启动 Electron、GUI、剪贴板或 Docker，也不能证明真实数据库帧消费、SQL 单次执行、GUI 导出或安装包通过。

`tests/manual/q05-large-archive.mjs` 只在显式选择模式后运行。它使用已有开发依赖 esbuild，把 `q05-archive-driver.ts` 和原产品写入器编译到本次随机临时目录；没有修改产品实现。真实调用链仍为 `createQueryStreamFile → QueryCsvArchive → QueryZipWriter → AtomicFile → 原生文件句柄`，未注入文件接口、偏移、CRC、短写结果或截断占位文件。

驱动以异步生成器逐帧提供结果，消费者必须等待 `writer.write(frame)` 完成后才获取下一帧。单行固定为 256 KiB，当前行包含结果编号与唯一八位行号；只复用固定大小载荷，不保存全体数据行。原字段/行预算、至多 64 KiB 小片段缓冲、真实 CRC 累积、sync/close/rename 和 10 GiB 整包预算保持原样。生成期以 Node 原生 zlib CRC32 和 SHA-256 另算每个 CSV 的独立预期，未复用产品 CRC 实现。

归档依次包含第一行集、清单中的中间状态、第二行集、第三空行集及 `manifest.json`。大模式计划如下；这些是计划值，并非已完成的大文件实测：

| CSV | 数据行数 | 完整 CSV 字节数（含标题） | 大边界目的 |
| --- | --- | --- | --- |
| results/rows-001.csv | 16385 | 4295229459 | 单条目大小真实超过 4 GiB |
| results/rows-002.csv | 8 | 2097171 | 本地头偏移在第一条目之后，必须超过 ZIP32 |
| results/rows-003.csv | 0 | 19 | 跨界后的空集仍独立存在 |

所有行都经原写入器真实写入，不采用稀疏文件、seek、打洞、虚构目录偏移或 CRC 替换。最终清单和中央目录也在跨界之后写入。

## 独立流式解包

`tests/manual/q05-verify-archive.py` 仅使用 Python 标准库，不导入产品代码或小包整体读取帮助器。先读固定 98 字节尾部，限定中央目录最多 64 KiB 且指向真实文件位置，防止损坏目录长度诱导 `zipfile` 整块读入 GiB 数据；随后 `ZipExtFile.read` 每次最多 1 MiB，不在磁盘额外展开 CSV，不整体读入 4 GiB 文件。只有本场景至多 64 KiB 的清单可收集为 JSON，独立预期文件也限制 64 KiB。

每条目均比较实际累计字节与目录长度，独立计算 CRC32 并与 ZIP 目录核对；每个 CSV 的实际 SHA-256/CRC32/长度还须等于生成期独立预期。清单同样完整读到 EOF，核对其 CRC、长度并记录 SHA-256，随后逐项校验格式、编码、CSV 约定、原结果序号、行集序号、列位置、行数、CSV 字节数、空集及中间状态。还检查固定路径、顺序、STORE 大小及 Windows 普通文件属性，拒绝稀疏文件和重解析点。

大模式只有在首条目实际长度超过 `0xffffffff`、后续全部条目（含清单）的实际解码本地头偏移也超过 `0xffffffff`、整包真实大小超过 4 GiB 时才通过；普通小包即使使用 ZIP64 头也不会得到“大边界通过”结果。Python 是独立标准库校验器，本轮未另运行 Windows tar。

## 显式启动与资源限制

默认不运行，不带参数只显示中文帮助。它不在 `tests/unit` 中，也未接入 package scripts、CI 或产品入口。大模式同时要求 `--large` 与环境开关；单独提供 `--large` 会在创建临时目录前拒绝。

在要验证的普通克隆根目录执行。Python 必须是已有的真实可执行文件绝对路径；不下载依赖或调用 WindowsApps 占位启动器。当前机器已有的工具运行时示例：

```powershell
$q05Python = 'C:\Users\zhao-\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
# 小样本：真实约10MiB，保留ZIP与证据。
node tests/manual/q05-large-archive.mjs --smoke --python $q05Python

# 仅由统筹在资源窗口内明确启动；本次准备任务没有执行这条大模式命令。
$q05PreviousFlag = $env:DBARK_Q05_LARGE_ARCHIVE
try {
  $env:DBARK_Q05_LARGE_ARCHIVE = '1'
  node tests/manual/q05-large-archive.mjs --large --python $q05Python
} finally {
  if ($null -eq $q05PreviousFlag) {
    Remove-Item Env:DBARK_Q05_LARGE_ARCHIVE -ErrorAction SilentlyContinue
  } else {
    $env:DBARK_Q05_LARGE_ARCHIVE = $q05PreviousFlag
  }
}
```

所有输出只在当前克隆 `.cache/q05-large-archive-随机串/`。创建后记录真实绝对路径、随机所有者标记和源码 SHA-256；不接受任意外部目标路径，不覆盖现有用户 ZIP。大归档目标首次创建在独占目录中。额外用一个自有旧目标取消样本，在真实写入超过 64 KiB 后主动取消，要求其原字节不变且对应 partial 清零。

写入前根据目标卷 `statfs` 检查可用空间，按计划 CSV、产品 8 MiB 清单预算、额外结构预算和 1 GiB 余量计；大模式启动至少需要约 5.02 GiB 可用空间，实际判定使用精确字节。每累计约 256 MiB 再检查剩余空间并记录进度、写入行数及进程内存。总计划上界必须小于产品既有 10 GiB，真实写入器还独立执行该上限。SIGINT/SIGTERM 会请求取消，验证子进程阶段则终止子进程，主流程保存失败记录；操作系统强杀或断电仍可能留下 partial，不能当成成功包。

默认保留目录。需要成功后释放 ZIP 空间时，可在启动命令追加 `--cleanup-success`：全部验证通过后，重新核验真实绝对路径、父目录、所有者标记和普通文件属性，仅删除本次 `archive.zip`，其余 JSON/日志保留。不递归删除临时目录。失败不执行成功清理；产品 abort 会按原语义移除未提交 partial，失败时字节/行数快照、进度、错误及已提交归档仍尽可能保留。不要根据不完整包自动重放 SQL。

## 证据与本轮实际结果

`run.json` 保存计划、开始/结束状态、源码哈希、运行时、磁盘预算、实际字节、逐条目摘要/CRC/偏移和观测内存。`expected.json` 保存生成期 CSV 预期，`progress.jsonl` 保存进度，`verify-stdout.log`/`verify-stderr.log` 保存独立解包原输出。小模式还以错误 SHA 预期作负对照，必须被同一独立解包器拒绝；大模式不为该对照额外重读 4 GiB。

本轮仅做小样本，未执行 `--large`：

- 两次真实写入均为 40 行、10,488,130 字节；第一条 CSV 8,388,627 字节、第二条 2,097,171 字节、第三空集 19 字节、清单 1,477 字节。每条目长度、CRC 与内容校验通过，两次错误 SHA 负对照均被拒绝。
- 第一次保留 ZIP，第二次验证 `--cleanup-success`：ZIP 已删除，`run.json` 和其他证据保留。
- 第二次观测 Node 写入进程 RSS 最大 99,180,544 字节、堆最大 26,761,664 字节；这是逐帧采样，不是全进程树或大模式内存验收。
- 取消保护样本在真实写入 210,075 字节后取消，原 29 字节目标完整保留，partial 清零。另在主归档真实写入 1,310,809 字节、5 行后主动取消，原异常对象保留、旧目标未变且未提交归档/partial 清理通过。
- 默认入口和未开启环境开关的大模式均未创建验收目录。TypeScript `tsc --noEmit` 与入口语法检查通过。

员工1本地证据在独立克隆缓存：`.cache/q05-large-archive-VXufJ3/`（首次小包保留）与 `.cache/q05-large-archive-8oYBWS/`（成功清理、取消快照及类型日志）。不提交缓存、ZIP、运行时或构建产物。**超过 4 GiB 的真实写入、跨界后的独立解包及其资源观察仍未验，须由统筹使用此入口统一执行。**
