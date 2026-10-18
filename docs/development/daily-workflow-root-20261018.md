# 常用功能组合的主线整合记录

组合开发基线为 `3985b421c1ce908013321ed8a822212504d72428`，使用新的普通克隆及任务分支 `codex/p0-daily-workflow-v027-20261018`，没有使用工作树或改动原工作区。当前候选版本为 0.27.0，包含 CSV 导入分隔符和新建表自动更新时间；尚未公开发行，本版构建及平台验收按固定头单独记录。

## CSV 导入分隔符

作者固定提交 `85d65208ef8528b65714d382c53b3b666e9b0a41` 已整合为 `4b89b011bc8e879fa4d28115e4a1a52ff05da6ae`，整合树与作者树一致。作者交接 JSON 的 SHA-256 为 `5713ec7897391cfd9837e6a464142caf73d0e35dc6b05dba85b67433b7eed0b8`，主线已读盘核对。

导入窗口支持逗号、分号及单字符 Tab，默认仍为逗号。分隔符参加文件预览及异步表单的身份判断；更改参数立即使旧样本和映射不可用，执行入口再次检查当前就绪预览。预览与完整流式导入共用相同配置。该片不增加无表头、自动猜测或 CSV 导出分隔符功能。

独立审查未发现阻止接纳的已证问题。两个独立对照通过：超过 64 KiB 读取块的 UTF-16LE Tab 文件保留引号内分隔符、CRLF、尾空列、NULL 和精确数值；实际导入调度在第 501 行后取消，保留前 500 行已提交批，回滚当前 1 行且没有第 502 条 INSERT。后者使用 RAM 驱动端口，不是数据库端事务验收。

独立交接 `.cache/employee4-csv-delimiter-review-20261018/.cache/csv-delimiter-audit/handoff.json` 的 SHA-256 为 `b9ff31ad9543d8833a36facda993f2c75d3cfe76812c91fbbbe180e827785994`。原 36 处预览断言及原分批、取消、回滚控制流保留。

主线固定整合提交的 9 个直接受影响文件共 162 项通过、0 失败、0 跳过，类型检查退出码 0；作者和主线是重叠用例，不累加为 324 项。实际命令：

```powershell
node .cache/run1731-verify-csv-import-root.mjs
```

控制器关闭环境文件读取，使用独立 TEMP/TMP 及 Vitest 缓存；仅正式流式读取器、Engine／React 组件与模拟驱动／IPC，不启动 GUI、数据库、Docker、服务、端口、安装程序或剪贴板。主工作区原始日志 `.cache/parallel-integration/run1731-csv-import-delimiter-root/unit.log` 的 SHA-256 为 `51839cbcd01c9314a89b27aad0ff7390b4f55f4eb63a667a849120e862fc0e87`，成功类型日志为空，SHA-256 为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。

## 尚待完成的边界

CSV 原生操作、实库最终数值／字节及跨版本验收尚未执行。既有 0.26 安装候选不自动继承新功能。新建表自动更新时间和格式化大小写偏好仍是独立开发任务，其代码、验收及结果需接收固定交接后另行记录。

公开预览仍为 0.21.0。本记录不表示 F01、O01、Q01 或 Navicat 全功能完成。

## CSV 固定头的首次完整 CI

原 Git 推送遇到连接失败；Root 先核对目标分支不存在，再通过既有认证仅上传 2 个不可变提交的对象。原 SHA 全部一致，随后创建目标引用并经 GitHub API 回读 `cf04a571e135dec729d6726fe1b969038ec702ba`，本地远端跟踪以不存在时才创建的方式登记，领先／落后均为 0。没有强推或改变作者提交。

该固定头的 [CI 39100903448](https://github.com/zhao-yc/DBArk/actions/runs/39100903448) 已成功：job `117596793965` 的 506 个文件、9339 项通过、10 项条件跳过，类型与构建成功。桌面和发行条件步骤跳过。主工作区冻结原日志 `.cache/parallel-integration/run1736-csv-import-full-ci-green.log` 为 143050 字节，SHA-256 `4e0302f712935873e5932dacfdf0052dd9f30432366e448ece9bd5f6d7c0e4e0`。本轮没有本地新安装包，也没有 CSV 真实控件或数据库存储证明。

## 新建表自动更新时间与两项修复

固定作者链 `36868c2ffacd4f55f221b64e904d9476c23091ab` → `e4b2353d780862dabb13bd023dcb367ed2be35c1` → `259b77f6b55befb157568acff24a0996803b6103` 已依次整合为 `c0dae169dc9f309de555e3ba031e5307c619c7d4` → `c6103b2b98c02bfca4e2dd917e54bc21d6d79433` → `f4c928ec8fecb90e2cf32d41d80da5f280081c2a`。全部功能文件与作者终态逐字一致，CSV 代码继续保留。

普通 DATETIME／TIMESTAMP 字段的受控 `ON UPDATE CURRENT_TIMESTAMP(p)` 已从表单贯通至严格 IPC、SQL 预览、原单次创建及 SHOW／目录后核。类型、默认值、可空性和精度须一致；新键省略时沿用旧行为，任意表达式和不在受控版本范围的显式属性拒绝。完整类型与版本边界见[功能说明](table-create-on-update-20261018.md)。

独立审查发现并保留两项原 P2：合法前缀索引与非键时间列组合被旧 EXTRA 白名单拒绝；非法 `on update CURRENT_TIMESTAMP DEFAULT_GENERATED(3)` 被删除标记后错误重组成合法函数。它们分别影响创建后核验的假阴性和假阳性，未证明真实服务器返回后者，也不是已证数据错误或写操作重放。

前缀修复仅对本次明确请求的对应时间列接纳准确属性，保留真实列适配器、类型／NULL／精度、空字符长度元数据、完整 STATISTICS 和 SHOW 复读。时间列没有因此成为可用前缀键。标记修复完整匹配单个独立前置 `DEFAULT_GENERATED`，中间、末尾、重复或未知后缀继续拒绝。

独立审查的原 4 项对照由 1 通过／3 反例失败变为 4 通过／0 失败，没有修改脚本期待；原 368 头及 15 份证据字节保留。修后交接 `.cache/employee4-on-update-fix-review-20261018/.cache/on-update-fix-audit/handoff.json` 的 SHA-256 为 `120a50d245ccd4ecd3d6aaadf6d69e012efcce352af438db8a68d17d586484a1`。作者最后追加交接的摘要为 `1c51a0d03bac2155482f3d51e548d5c1449d022cd82251755910cef15282aabb`。

在固定 `f4c928e` 上执行 11 个直接受影响文件，428 项通过、0 失败、0 跳过，完整类型检查退出 0。实际命令为 `node .cache/run1741-verify-table-create-time-root.mjs`，采用隔离临时目录／缓存且关闭环境文件读取。主工作区日志 `.cache/parallel-integration/run1741-table-create-on-update-root/unit.log` 的 SHA-256 为 `e3579eee5515134463552f3ea804170d73660390e38b0c3a2e21f8bdb81c18d3`。该数字与作者窄测有重叠，不相加为全套。

至本节时点，未运行本版 GUI、实库、安装、macOS 或 Docker。版本提升只改 package 版本与文档，不冒充新的类型、完整 CI 或安装验收。关键字大写因默认静态加载开销仍在独立修复，尚未进入本组合。
