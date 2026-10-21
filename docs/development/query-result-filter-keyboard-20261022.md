# 筛选草稿键盘事件保护

## 行为变化

结果筛选面板只在明确的 Ctrl／Meta+Enter 时应用，单独的 Esc 时取消。子控件已消费的事件继续留给原控件，带 Ctrl／Meta／Alt／Shift 的 Esc 不关闭正在编辑的草稿，与排序面板保持一致。普通Enter、输入法组合／原生isComposing／229、长按和旧面板租约仍沿原保护，不增加SQL或数据库访问。

本轮不改筛选表达式、预算、排序重置、撤销历史、复制和导出合同；取消按钮在输入法组合期间仍可明确取消，保持已有行为。

## 检查

基线 `0fbfe49b`。先新增两项实际React／QueryTab RAM回归，原产品运行两项均失败（140项未选择），均因原handler继续消费不该处理的事件；原记录不追认为通过。修正后会话35015退出0：类型28.57秒、四文件171项通过、普通构建36.84秒／Vite35.68秒，总76.82秒，原Zod注释和大包警告保留。

命令为 `node scripts/check-local.mjs --build tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-history.test.ts tests/unit/query-result-sort-case-grid.test.ts tests/unit/query-result-sort-case-gate.test.ts`。原140项组件回归全部保留；新增两例核已消费的Ctrl／Meta+Enter及Esc、四种修饰键Esc、草稿值与原行身份、取消保持重做、应用后撤销及单次query.execute。该RAM端口不作为原生输入、窗口或安装证据。

原生专项另追加从实际下端点文本框按Shift+Esc，核面板及两个精确端点保持，再继续原点击应用和准确三行断言。原120秒、retry0、完整矩阵、审计及两文件读回不降；当前只是准备，尚未执行新增段落。

新增原生段落后，会话27201类型28.26秒、原5项默认关闭／列表／授权门通过，总30.40秒，退出0；默认Playwright列表仍准确一例。只有测试文件变化，未重复产品构建，`git diff --check`通过。

## 串行边界

WIN11-TEST 已派发的 `7410f68e` 回合继续固定原提交，不中途升级为本轮产品或替换构建。它只验证此前排序快捷键及小数底边修正。远程读取再次返回主机不可达，本轮独立类型／RAM／构建按用户授权在本机进行，没有重复该GUI。新筛选按键保护的窗口、安装及macOS仍未验，暂不发布。
