# INSERT SET 新行别名字段补全

## 实际行为

已确认支持新行别名的MySQL会话，编辑 `INSERT INTO app.sales SET amount=1 AS incoming ON DUPLICATE KEY UPDATE amount=incoming.` 时，原编辑器／Worker／建议器可读取准确目标 `app.sales` 的字段。复用原能力门：MySQL8.0.19起的已认可8.x开放，旧版、MariaDB、未知厂商及缺省消息关闭。依据[MySQL8.4新行别名](https://dev.mysql.com/doc/refman/8.4/en/insert-on-duplicate.html)与[MySQL8.0语法](https://dev.mysql.com/doc/refman/8.0/en/insert.html)，不是本机Navicat的实测结论。

SET仅收普通列名等号赋值、同层尾AS行别名及同条更新右侧。CAST内部AS、字符串和注释不声明新行。限定目标只读该库表；未限定目标使用可信默认库，未知时零目录读取。UTF16原替换范围、引用名、前缀、权限、取消和Worker白名单保持。

空赋值、尾逗号、限定左值、列别名列表、同表别名、大小写不一致、嵌套SELECT及越界拒绝，不回退同名schema函数。缺右括号使尾AS进入表达式层时，完整尾关键字只标记局部名并停止；正常CAST类型后仍可读取真实schema函数。

## 解析与验证

dt-sql-parser4.5.1误拒绝SET末尾COALESCE／JSON_EXTRACT等函数后的AS或ON。仅在补全内部AST投影给已确认的赋值表达式加括号，DEFAULT独立保留，再核词法预算、完整语法和同一AST目标表。没有删除AS或跳过语法门；表头位置、原编辑替换范围、用户SQL、历史、执行文本及IPC不变。

虚拟机保持固定3005511批量筛选窗口，未切产品；远程连接有反复，本机独立源码检查无GUI／数据库／系统剪贴板。首轮3文件78项为75通过／3失败，PID51776、exit1、37.9158708秒；第二轮10文件342项为340通过／2失败，PID52676、exit1、38.5645577秒。两轮类型通过，失败后未构建；原复杂合法输入、缺括号反例和期待保留。

修正后PID38808，创建UTC2026-10-21T05:21:43.2396244Z、完成05:22:56.3128385Z，exit0、73.088817秒：类型27.37秒、10文件342项全通过／无失败跳过、Vitest9.30秒，构建35.36秒／Vite34.47秒。包含SET29项、原VALUES／AS定位，以及分析、LATERAL、窗口作用域／继承／帧／真实Worker消息。子环境无DBARK_*，保留Rollup注释和大分块警告。

命令为 `node scripts/check-local.mjs --build`，明确指定 `tests/unit/` 下的 `completion-insert-set-row-alias.test.ts`、`completion-insert-row-alias.test.ts`、`completion-insert-row-alias-as-position.test.ts`、`completion-analysis.test.ts`、`completion-lateral-scope.test.ts`、`completion-window-scope.test.ts`、`completion-window-worker.test.ts`、`completion-window-inheritance.test.ts`、`completion-window-inheritance-completeness.test.ts`、`completion-window-frame.test.ts`。

三轮原日志分别保留在 `.cache/completion-insert-set-20261021/`、`.cache/completion-insert-set-fixed-20261021/`、`.cache/completion-insert-set-final-20261021/`；最终stdout SHA256 `165f1a6bbe639d24916d030e7c20e8549f40729266dd3c9bf845535a460ec4ed`，stderr `43760aee1239d4fba42c6819c827d82e6b02e4831b7886f853af59cfd72b018e`，均不入库。

## 未验范围

本次为源码、真实分析／建议器及RAM Worker证据；实库插入、原生接受／Undo／Redo、安装和macOS另验，不沿用旧VALUES或窗口帧通过。完整CI另记，Q01仍部分，暂不发布。
