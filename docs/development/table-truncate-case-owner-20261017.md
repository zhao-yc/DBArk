# 单表清空正式用例的本例归属适配

本片从 Root 已推送的 `e3d9dc3722707fcb3fcfe3e43bbe0d84d947e914` 创建独立普通克隆与 `codex/employee4-p0-truncate-owner-20261017` 分支。产品已有单表清空入口，正式用例已通过双门和 list 前短路注册；本片只修正该正式用例的 P2 归属与等待缺口，不增加产品功能或实际验收数量。

## 文件边界与修正

- `tests/e2e/table-truncate-live.ts`：沿用现有严格 TestInfo owner，固定首次捕获的应用和页面。进入隔离建库 helper 前、每次取得页面/弹窗及关键 await 后核对；归属失效或窗口已关闭时停链，不操作另一例窗口。
- 七条原观察 SQL 全部沿用，增加本文件局部 `observe` 包裹。SQL 拒绝、未知或迟到成功却失去归属时先标记保留并抛原首因，禁止后续 SQL/UI；标记自身异常不能覆盖原首因。现有严格清理链看到保留状态会停止退出、DROP、end、强杀和目录删除。
- 点击关闭之后等待真实弹窗零计数，覆盖原对话框异步释放预览/快照后才卸载的行为；不以 click 返回替代释放完成。
- `tests/unit/table-truncate-case-owner.test.ts`：在 VM 中执行真实正式模块，UI、观察连接和注册仅用 RAM 端口，新增 16 项归属、未知结果、迟到响应、关闭释放及原 SQL/确认合同检查。

未修改共享 desktop-fixture、live-helpers、默认 false/else、quitDesktop、产品或正式入口。新建库 helper 在基线中已具备严格归属及新建库预览/准确确认流程，本用例继续复用它；相关既有纯测试继续通过。

## 保留的真实行为合同

正式身份仍为“真实UI准确表名与完整风险确认；旧预览不能双发，数据和自增经观察连接核对”。没有新增 test timeout、retry 或执行器；使用原默认 45000 毫秒和 Root 的零 retry 调度。

保留版本/Linux/大小写门、原 CREATE/INSERT/SELECT 七条观察 SQL、尾空格确认必须拒绝、三项风险确认、单次 apply、清空后零行，以及重新 INSERT 后自增 ID 为 1 的断言。TRUNCATE 会重置自增；没有假设物理表 ID 或原自增计数不变。

本例不做标签消失的负断言。当前产品成功回调标记结构失效并刷新，不承诺关闭标签，因此无需虚构“旧标签消失”的定位合同。需要零计数的是关闭后的弹窗：此前已通过实际预览/确认/成功状态取得同一弹窗的正向命中。

## 本轮验证边界

在独立 ignored 配置中禁用 envDir，并给测试 worker 加载拒绝网络、真实子进程、私有配置读取和密钥生成的守卫。仅复用现有 node_modules junction，没有安装依赖。

- `table-truncate-case-owner` 16、`table-truncate-list-guard` 12、`truncate-exit-preserve` 32、`database-create-cleanup` 5、`table-drop-case-owner` 12，共 **77 项纯测试通过**。
- TypeScript `--noEmit` 通过。
- 两门均打开时，守卫下实际执行 Playwright `--list --workers=1 --retries=0 --trace=off --reporter=json`；只收集原默认关闭 skip 身份，`results=[]`、无错误，未加载 live/桌面/私网配置。纯入口测试另外覆盖 list/list=json 与四种门组合，证明 list 先于环境读取短路。
- 原严格退出的 32 项既有纯测试继续证明实际 close/PID 未确认时保留、旧 TestInfo/实例失效、仅 ESRCH 放行、任务读取未知及新建库 helper 兼容；这些都是 RAM 控制证据。

实际 GUI、安装、Server-200、数据库、认证读取、clipboard、Docker、CI 操作均为 0。Root 后续独占隔离 MySQL 8.4 正式 UI 1 项，必须另行核实际退出和资源清理；本轮不能据纯测试或列表宣称真实 TRUNCATE 通过。

详细纯测试与列表 JSON 位于本克隆 `.cache/truncate-case-owner/`，不提交守卫、配置或结果文件。
