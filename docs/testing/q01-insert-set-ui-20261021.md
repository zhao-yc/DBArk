# VALUES／SET 新行别名界面验收

## 固定内容

原 `sql-completion-insert-row-alias.spec.ts` 默认关闭及`--list`短路保持。沿同一真实窗口，在原VALUES场景后增加普通SET、嵌套COALESCE／CAST的SET，共一个整例、三场景。每场景实际输入点号，核对来自专属subject的id／note／created_at三列建议，接受note后核原SQL，再真实Undo／Redo核精确正文，任务身份／状态及历史编号保持。附件只在各断言通过后记录场景布尔，不打印配置或认证。

维持原120秒、零重试、沙箱／上下文隔离、trace／截图／视频关闭及捕获owner正常退出。只编辑不执行INSERT正文，不调用系统剪贴板；不以浏览器keyboard事件宣称系统级输入验收。

## 准备证据

远程反复不可达时，本机仅运行独立准备：`node scripts/check-local.mjs tests/unit/completion-insert-row-alias-ui-gate.test.ts tests/unit/completion-insert-set-row-alias.test.ts tests/unit/completion-insert-row-alias.test.ts tests/unit/completion-insert-row-alias-as-position.test.ts`。

原PID30156，创建UTC2026-10-21T05:48:08.8024940Z、完成05:48:43.1980939Z，exit0、34.4093819秒。类型25.75秒、四文件84通过／0失败／0跳过、Vitest7.70秒；没有普通构建或GUI／数据库操作。产品src与已构建9139一致，新增只是实际用例及4项入口守卫。

新增守卫执行真实spec声明，确认缺任一门仅跳过、不读认证，`--list`和`--list=true`不访问环境或加载桌面模块，显式双门只登记一次。不是实际窗口或数据库证据。日志`.cache/insert-set-ui-preparation-20261021/`保留，不入库。

## 正式验收条件链

优先交WIN11-TEST；远程不稳可按用户授权在本机运行这一独立用例，但不能重复可能已派发的批量筛选复验。先核准确Git／构建输入／新独占目录和无本例原进程，记录实际平台；状态不明则保留。使用原120秒整例命令，不追加其它测试：

```sh
node node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-insert-row-alias.spec.ts --reporter=json
```

Root以显式RAM目标和专用配置在200／13384独立核MySQL8.4.11、Linux、大小写及准确UUID，确认观察连接正常关闭。仅新随机`dbark_upsert_<32hex>`库、subject空表，字段id／note／created_at；创建前确认不存在、记所有权及原定义，不创建用户／权限，不SSH／Docker、不落盘凭据。UI通过原双门及策略取得同一明确RAM快照；不靠用例读取凭据文件补缺项。

保存正式CLI原生PID／创建／退出、原stdout／stderr及实际三附件；known-secret扫描只回布尔，原件私有保留，不能将敏感对象回到工具输出。失败或资源unknown停链，保留本例profile和数据库，不强杀、补清理或重跑。

仅正式GUI全部成功、捕获owner正常退出及profile删除后，用独立准确连接核该subject仍0行、定义不变且本例库无活动会话。只删除确认为本轮新建、结构和对象列表完全匹配的随机库，再独立核不存在并确认验证连接native／stream正常关闭；原其它失败资源保持。终核源码／测试／构建／Git及本例进程身份，封存原日志和报告。暂不发布，Mac／安装／实际INSERT执行仍须分别验收。
