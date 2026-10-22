# 执行计划属性与查找：Windows 实库整例

## 准确身份

- 分支 `main`，提交 `4b418bc1380701c04b2343d05ebf14c984f924a0`，产品树 `8cd422c1fab40aea5f3d2111344be5e1dafaa1bd`。
- 本机 Windows 源码构建，采用已授权的备用环境；WIN11-TEST 会话可读且空闲，原派发未启动，没有双端重复执行。
- 正式 App → Main → utility process → 200／13384 MySQL 8.4.11；运行前只读核对版本、Linux、大小写设置和准确 server UUID，预检原流正常关闭。
- 临时配置不记密码、不指定数据库、不启用 SSH/TLS；仅解释自带常量 UNION 派生表，无业务表读取、服务器写入、Docker 或系统剪贴板操作。

## 实际行为与读回

正式表单新建一条连接，正常新建查询并在真实编辑器输入固定 SQL。Main 审计在首次执行前绑定原 sender／连接／标签／SQL／会话，仅放行一次 `query.explain`；未知执行、事务、文件及连接修改请求在原处理器前拒绝。原 120 秒、零重试、无认证录制和失败保留规则保持。

实际点击执行计划后，先收起全部节点，再查找 `using_filesort`：找到收起的排序节点，展开祖先并获得焦点，详情原值为 `true`。查找 `using_temporary_table` 得到两个节点，前后切换分别显示原 `true`、`false`，不把缺失等同 `false`；查找 `used_columns` 显示 `["dbark_plan_value"]`。

在 1024×680 原生窗口内滚动详情，字段属性行完整进入视口（比例 1），计划区域没有水平溢出；区域与属性行截图已人工复核，标签、原字段名和值可见。此处是 Playwright 浏览器交互，不作为操作系统输入验收。

所有阅读动作后 Main 计数仍为 `{explains:1,sessions:1,pending:0}`；唯一任务为 `query.explain/completed`，执行历史与页面错误为空。正常退出后成功轮临时 profile 按原夹具收尾。Python 标准库独立只读界面取得的 JSON，确认排序 `true`、物化临时表 `true`、UNION 临时表 `false`、准确使用字段及两个 `No tables used` 常量分支，读前后摘要一致：

`eb480b9ef8c30ae8a3dc5912368b9e0243a98cb70e2ef530eb44e083dc3d0277`

GUI 原生 PID 40444，退出码 0、4.873 秒；框架一例通过，0 失败／跳过／重试，4.317 秒。Python PID 75868，退出码 0。另一次前期只读形状预检及第二轮整例分别记录，不将它们合称全程只有一次 SQL。

## 原件与回归

忽略目录 `.cache/explain-properties-ui-local-20261022-r3/` 保留原字节日志、进程身份、完整报告、截图、输入快照及独立读回；原计划文件位于该轮独占输出目录，没有进入仓库。Root 再核 30 份封存原件及运行前后 2209 份输入（109 份构建），全部摘要相符。清单 SHA256：

`5188d28164bdbe54c891dd9a91383f2c60d2a6ec907ee91a7b9e213636334c72`

属性行截图 SHA256：`463c706350344b655f6641639e3e35d2e8d48c07c9afbf4bf9f2429b4dc22c33`；区域截图 SHA256：`606713c9b2a9dca4a12d7b657c8e57ea6a7e2ee130049ac9be500eb4225db726`。

源码检查点 `c523d004` 的类型／构建及完整单元通过：652 文件、12766 项，1 项 POSIX 平台跳过，270.98 秒、退出码 0。后两提交只改测试与边界文档，产品树不变；最终类型与默认关闭列表再次通过。

| 日志 | SHA256 |
| --- | --- |
| `.cache/explain-properties-full-unit-20261022.log` | `fe76980dbc70b012f7da850a4fe5db30dc8368bd0ecfae592c52b33f77046071` |
| `.cache/explain-properties-typecheck-final-20261022.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `.cache/explain-properties-final-build-20261022.log` | `a2a407f79a28e880cf81d3e8fc8cdb7dac49e56bd2e17453a3c860dfac3fcdf5` |

## 失败与未验范围

首轮 `c523d004` 在正式执行前未观察到准确 SQL 草稿，窗口／profile／日志保留，未补点或重试旧例。测试从 textarea 改为编辑器 textbox 角色后，第二轮 `9c08a465` 原生整例／Python读回通过（29 封存、2209 输入不变）；首张截图只覆盖详情开头，未冒充属性行可视，因此第三轮补强可视断言。Monaco Native EditContext 的只读 IME textarea 是静态定位风险，不能据后续通过确认首轮唯一原因。

五版本计划形状、错误类型、精度、预算、截断及 ABA／旧事件由静态与真实 React 单元覆盖；本轮实库原生仅证明上述 MySQL 8.4 常量计划组合。新安装、macOS、其它数据库版本、权限／取消、真实业务计划及完整复杂节点语义仍待验。Q07 完整工作包和发行计数不增加，暂不发布。
