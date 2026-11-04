# SQLite 整行 JSON 编辑（2026-11-04）

## 使用

在可写 SQLite 物理表页编辑已有记录、新增记录或复制记录时，可在窗口选择“SQLite 整行 JSON”，与原“SQLite 字段表单”往返。两种方式共享当前输入；切换先完整校验，非法 JSON 或字段值保留在原界面，不会丢弃或部分暂存。单元格窗口继续只编辑该格，不显示整行入口。

文档按真实字段顺序列出名称、声明类型、生成列标记及 value。只修改 value，不更改文档格式、字段顺序和说明信息。整数、实数、文本及二进制值均使用字符串，例如：

```json
{"kind":"integer","value":"9223372036854775807"}
```

二进制使用完整十六进制，例如 `{"kind":"blob","value":"00ff"}`；`{"kind":"null"}` 为数据库 NULL。新增或复制记录的 `{"kind":"default"}` 表示省略该字段、使用数据库默认值，与 NULL 不同；已有记录不能改为 default。TEXT 内的 JSON 仍是原字符串，不自动解析、重排、去重或改变数值原文。

“保存 SQLite 本地草稿”只暂存一整行，沿用原撤销／重做。最终写库仍须原 SQL 预览和明确提交。表单导航同样使用这一整行输入；非法 JSON 不导航，跨页仍遵守原干净页门槛。取消窗口放弃本次输入，不提交数据库，也不放弃其它已暂存草稿。

## 实现与边界

- 纯 Renderer 新增 sqliteRecordJson，使用 SQLite 原 typed 值，不通过 JavaScript Number 传递整数或重新解释声明亲和性。不新增 IPC、数据库任务、路径或持久化记录值。
- 开始编辑时复制并冻结字段说明及原值。整行格式为 DBArk-SQLite-record／版本1，有序 fields 数组不把原型同名字段当作对象访问路径。
- 先用现有有界词法树扫描完整文档及全部重复成员，再 JSON.parse；包括转义同名成员也拒绝，不能由后值覆盖前值。严格校验格式、字段数量、顺序、真实名称、类型声明和生成列标记；全部通过后才返回完整 typed 行，不发布部分修改。
- 生成列及超过原32768字节完整编辑预算的原 BLOB 不允许通过 JSON 改写。未触碰的原生非有限 REAL／大 BLOB 可原样保留；明确修改 REAL 仍须有限。普通新输入继续走 sqliteEditValueSchema 的64位、Unicode、字段长度及 HEX 规则。
- 输入同时限制2 MiB UTF-16／UTF-8，复用 BoundedRecordTextarea，完整粘贴先预检，不用浏览器 maxLength 静默截取。源字段总量先预检，再序列化，完整文档过限拒绝进入，原表单保持。无部分全文或自动截断。
- 原输入票据、精确页／行、已提交渲染、字段数组及 JSON 缓冲共同校验，切换方式同步撤销旧回调。换页、关闭、同 key 误复用或来源失效均不能使旧缓冲修改新页。

本轮是 SQLite 可写记录的整行输入，不包含只读记录树、JSON 节点结构编辑、多页草稿或持久恢复。D04／R02及完整 Navicat 目标继续部分覆盖，暂不正式发布。

## 实际验证

实际平台 macOS arm64、Node.js24.17.0及项目 Electron。WIN11-TEST只读检查不可达，未派发远端任务，按仓库规则回退本机。仅操作准确测试 owner 的合成 SQLite，未使用 Docker、SSH、业务库或系统剪贴板。

最终7份相关测试文件136项通过、0失败／跳过，不累加前面轮次。包含：int64两端、NULL与default、HEX、原型同名字段、TEXT中重复JSON成员／极大数／CRLF／非BMP／NUL原文；根／字段／值及转义重复成员；元数据修改、缺字段、重排、额外字段及非法typed值；生成列、大BLOB、非有限REAL原值保持、2MiB及UTF8、深度与尾部限制；正式React两种界面互换、非法输入不部分保存、旧回调／失效／导航、单格无整行入口，以及原Editor／Main提交及复制回归。

严格类型检查通过，最终构建17.84秒通过，保留既有第三方PURE及大分块提示。完整单元1289份文件全部通过，26817项通过、10项既有Windows平台tar条件跳过、0失败，退出0，470.72秒；独立统计full.json，不累加各轮相关计数。

新真实窗口专项最终4222毫秒通过。固定120秒、1worker、0重试、trace／自动截图／视频关闭，只授权唯一可写合成文件及 child 一张表，最多一次明确 apply：

1. INTEGER64位最大值、BLOB00ff、NULL及生成列原行，从字段表单的本地输入进入 JSON，准确类型保持。
2. 将整数误填为 JSON Number 后拒绝切回并显示中文原因；重复版本成员拒绝暂存，正文及磁盘保持。取消输入没有提前修改数据库。
3. 合法 JSON 改备注、64位最小值、BLOBff0001及NULL文本，切回表单核原值，再切回JSON仍准确。保存后没有新增表读取或apply；一次撤销／重做保持集中草稿。
4. SQL预览取消仍未写库，再次预览后明确确认唯一一次apply。独立原生连接回读全部列，64位最小值、完整字节、NULL文本及生成表达式结果正确，控制行保持。
5. 新增窗口整行JSON明确显示default，取消并撤销新增后数据库仍两行；已有行再打开JSON可查看准确新原值。
6. 零越界／页面错误、无遗留任务，所属Electron退出0、原fixture删除准确目录，再独立核文件系统不存在。已查看完整JSON窗口PNG，原SQL预览及新增默认值PNG另存原件。

原 related-tables完整窗口整例3809毫秒通过：保留固定关联、51行范围、预览取消及一次明确提交、父／普通子表草稿隔离、新增预填与重载后零全表读取等原断言。两个专项串行执行，所属窗口均正常退出0并精确清理。本轮没有功能测试失败、自动重试或强停；首轮新窗口成功原件保留，完善非法值中文文案后按原门槛复验。

Windows本增量、Mac Intel、安装包、实体输入法和人工辅助技术未验。原生专项未逐项注入所有预算、旧回调或并发冲突；这些由真实控制路径单元覆盖，不能泛化为逐项原生故障验收。文件chooser仅定向本例合成文件，未验OS对话框键鼠。

## 命令与交付

实际命令（项目Node24.17.0置于PATH首位）：DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=json（相关指定文件，完整单元无筛选）；NODE_OPTIONS=--max-old-space-size=2048 node scripts/typecheck.mjs；同2GiB堆 node scripts/build.mjs；node scripts/sqlite-workspace-ci.mjs record-json；node scripts/sqlite-workspace-ci.mjs related-tables；node node_modules/@playwright/test/cli.js test tests/e2e/sqlite-record-json-native.spec.ts --list；git diff --check。默认--list只列出1项，不启动桌面或数据库，无持续服务需要停止。

原始结果位于.cache/sqlite-record-json-20261104/及test-results/sqlite-record-json/、test-results/sqlite-related-tables/。项目归档.local/交付/2026-11-04-SQLite整行JSON编辑-v1/；自动备份/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-SQLite整行JSON编辑-v1/。

保留可编辑Markdown、源码／patch、各轮JSON／日志、完整原生报告／回包及PNG、交付ZIP。原件到归档、归档到备份逐文件SHA-256核对，ZIP另核CRC；独立版本保留历史。未生成PDF、正式安装包或发行，源码推送不代表发布。
