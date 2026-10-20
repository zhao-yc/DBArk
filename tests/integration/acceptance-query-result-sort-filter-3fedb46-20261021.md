# 多列 NULL 排序与结果筛选快捷键组合验收

## 准确源码与功能入口

测试固定 `3fedb46898f499f557942211218467d7c74d58db`，产品树 `ddd3c5182283266ada56517cbd7e044c0bb23293`。独立交付基线 `ab27fb1eefd03ea16ba36c912bb2dddf114d306c` 只同步 main 已验文档；源码、单元、E2E、脚本、CI 和依赖清单相对测试提交均无差异。不包含后继文本排序大小写选项。

多列排序面板逐列选择默认／NULL 在前／NULL 在后，显式位置独立于升降序；两个 NULL 继续比较下一优先级。表头方向切换、追加和优先级移动保留选项，移除再添加恢复默认。精确整数、小数、微秒日期、负 TIME、空串及文字 NULL 保持独立语义。

结果筛选面板支持 Ctrl／⌘+Enter 应用、Esc 取消草稿；普通 Enter 保持输入行为。有效快捷键抑制冒泡，额外修饰键、长按重复和输入法组合状态不触发命令。筛选与排序共用原来源租约及投影，复制和导出使用当前可见结果，不重发 SQL。

## 已取得的检查结果

| 检查 | 原始结果 |
| --- | --- |
| [Linux CI39488812125](https://github.com/zhao-yc/DBArk/actions/runs/39488812125) | job118856148040；类型／587 文件11275通过、10平台跳过／构建成功；单元223.80秒，Vite32.41秒 |
| WIN11-TEST 六文件／类型／新构建 | PID15252，退出0、96.176秒；301通过、0失败、0跳过 |
| 同一构建的独立实库 GUI | PID10824，退出0、15.890秒；1通过、0失败、0跳过；原120秒、零重试 |
| Python 标准库独立 CSV／JSON 读回 | 已派发，尚未取得终态 |
| Windows 完整单元回归 | 仅在独立读回和终核均通过后运行；尚未取得终态 |

Linux 的100项真实 QueryTab RAM 接线及18项 NULL 控制器用例均已包含在总计中，不重复相加。所有 Windows 类型、单元、构建及界面操作均由独立虚拟机“dbark测试”执行；开发机只做源码／档案静态审阅和 `git diff --check`。

## GUI 范围与原件

准确 Server-200／MySQL8.4／13384，一次三行八列常量 SELECT，不读业务表、不创建库表用户、不写数据库。真实控件检查 NULL／方向矩阵、精确比较、多列优先级及恢复原序。筛选最终保留原行1／3；Esc 取消修改、普通 Enter 不提交、Ctrl／⌘+Enter 应用及恢复均由原整例检查。

原通过用例同时确认审计 `queries=1、exports=csv/json、pending=0、revision=0` 和3个任务 completed，正常 owner 退出及 observer 原生同流关闭。审计对象和任务 ID 未另外导出；证据来自固定提交的原通过断言，未在退出后补查应用。复制使用页内 ClipboardEvent／DataTransfer，文件框只替换本例目标路径，不是系统剪贴板、操作系统输入或原生文件框验收。

VM 元数据目录为 `outputs/query-result-sort-filter-3fedb46-vm-20261021` 和 `outputs/query-result-sort-filter-gui-3fedb46-vm-20261021`。Root 已读原命令及报告摘要，未下载这些文件复算摘要：

| 原件 | SHA256 |
| --- | --- |
| 阶段 stage-result.json | `e2e89f70025d7555ed3ac4e0a66b75a055512536befc45999c03d23fb1159c2a` |
| 阶段 targeted-build-stdout.log | `ae8e84340bd8448da9cb0e92a08abd1c90bf7fa9f59bd89a1672eedd331c5885` |
| 阶段 targeted-build-stderr.log | `5cd93a38703c97fd6f8521da509fa752582269f38016d600eb413bcb68570967` |
| GUI gui-original.json | `296cde6398f4fb85aafd4c60efb225f382ce49f3c6953a840ac00330669c065b` |
| GUI gui-stderr.log（空） | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| GUI gui-stage-report.json | `b96667906c592942e178b7c879bd915b0370f067e7f0f82cf12bcb38edbfcb58` |

阶段 stderr 为构建注释及分块警告，不是空日志。GUI 后 Git 净、574源码和109构建哈希不变，原 CLI、观察进程及已记后代身份缺席。原 CLI 创建时间有观察记录；观察进程自身创建时间未捕获，不能把事后数字 PID 缺席当作该缺失字段。

## 保留的失败与记录限制

- 原 fcc8530 窗口在活动草稿联合预检失败，未执行 App 查询；持久草稿693／694字符的末尾额外单引号已只读取证，但原页面文本及具体自动配对原因未确认。后继只改用已有可见编辑器合成 paste 准备，原 SQL、期待、期限及产品不因此改变。见[原失败记录](acceptance-query-result-nulls-fcc8530-20261021.md)。
- 后继原5b4e7c3阶段 fetch PID15964退出128、5.168秒，GitHub TLS unexpected EOF；没有启动定向测试或构建。取得终态后另派准确3fed阶段，没有将观察超时当作重启理由。
- 3fed准备记录的整数键 JSON 序列化失败原件保留，后继用数组保存历史 PID／时间。首次失败对象没有完整落盘，其新观察时间缺失；后继时间没有回填为原始时间。
- 旧失败 profile 和输出保留；本次成功不追认它们的正常退出或清理。

## 交付边界

独立读回及完整回归仍须取得实际终态后，才能将组合源码交付 main。新安装包、macOS 新能力、其它实库基线、原生输入法及系统输入未验；既有 main f505f6b 三平台离线源码／安装结果[单独记录](acceptance-main-f505f6b-ci-20261021.md)，不转作本增量证据。完整 Navicat 工作包仍为部分，暂不发布。
