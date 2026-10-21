# Q01 窗口帧补全 Windows 单项实库验收

## 准确身份与功能范围

正式产品与用例固定`0a4b23faf4f631d8204ef48f4fd79e6eb4059753`，src树`44853a769acc789cf3884dc1b495c1633ea42ead`；WIN11-TEST原回合`01a15c77-9561-7de1-9eef-ced5024c7469`已completed。采用现有200／13384／MySQL8.4隔离资源，先独立核UUID并确认预检连接正常关闭，不把预检SQL计作客户端执行。

唯一正式命令：

```sh
node node_modules/@playwright/test/cli.js test tests/e2e/sql-completion-window.spec.ts --grep 按服务器能力验证OVER和命名WINDOW，MySQL5.7明确跳过 --reporter=json
```

原150秒、workers1、零重试。结果为一个整例通过、0失败／0跳过、retry0；按源码顺序完成全部七个场景。原五个字段补全场景保留，新增内联OVER继承后补CURRENT和命名child补PRECEDING，均经真实Monaco接受、原生Undo／Redo、任务／历史不变，再执行保留的真实接受模型；两步结果各自为20／30／30，不重新填入预期SQL。

CLI PID12444由同一.NET handle记录创建2026-10-21T03:32:40.374397Z、完成03:33:13.165558Z、exit0、32.813秒。原stdout为完整JSON、4365字节，stderr为空。控制角色PID13524／14108／924／5052及正式CLI均exit0，创建身份分列保存在角色原件。

## 收尾和封存

严格fixture收尾通过；另对本例准确随机库只读核无残留，UUID匹配，验证连接native／stream正常关闭。该独立验证不冒充用例内部观察连接的额外逐事件审计。原profile已不存在，17条身份记录、15个PID候选终核零匹配；无强杀或补清理。

source576／tests1308／dist109、构建输入、Git、九套旧封存及原CSV／JSON保持，父RAM三项保留。新封存91文件逐项SHA复核通过，当前文件已知敏感值扫描无命中。Root读取测试会话原最终回报，未下载复算91份原件，也未在开发机重跑此GUI。

原件目录：`C:\Users\tester\Documents\Codex\2026-10-20\hi\outputs\q01-window-frame-gui-0a4b23f-vm-20261021`。

| 原件 | SHA256 |
| --- | --- |
| `q01-window-frame-gui-report.json` | `703d48ad61b196039c81040eb69d5c72b866f3abf286f09f2f004c4479340b34` |
| `SHA256SUMS.txt` | `dc4abd483ee9a789627d8790e205f3b5496f9be314039feb4c6844824cafd2af` |
| `gui/gui-original.json` | `292a77f43d72361beecf92b757fdcc8c24145cc422fc63207136a806a7c4faa8` |
| `role-identities-and-exits.json` | `3d99adc3456f0f6d35cc9e75507bd6b844fda25cd13b1a702f2648fc74a120ed` |
| `attachments/live-window-completion.png` | `e8b9579106e2ee0d66f8e3f136a7b3eb14ca811e8551a94625b97da02c956eaf` |

## 原失败及未验边界

首次监督器语法门失败发生在正式GUI启动前，修正字符串替换后仅启动一次正式整例；失败脚本及原日志保留，属于控制准备事件。两条长请求后来到达，合并同一任务，没有重复fetch或启动；原短状态回合“当时未见”不改成永久未送达。

此前含凭据RAM对象误输出事件的完整用途和暴露范围仍未知。文件扫描无命中及功能通过不表示事件已处置；不复制敏感对象、不删除旧证据、不擅自轮换凭据。

Windows准备d155同产品的类型、24文件699项及新构建已另封存78份；准确0a4的Linux类型／592文件11460通过、10平台跳过／构建也另有证据，见[开发记录](../../docs/development/q01-window-frame-inheritance-20261021.md)。本GUI不包括筛选启停12c、其它驱动版本、安装包、macOS或系统输入法。Q01完整工作包仍部分，暂不发布。

## main 整合检查

基于main904778c正常合入既有分支1040c5e，无冲突。逐文件核Q01输入仍与准确0a4一致，筛选启停及其904组合用例不被覆盖。按本轮远程失联的本机回退授权执行一次`node scripts/check-local.mjs --build`，明确指定帧分析、窗口作用域、真实Worker、筛选启停、结果RAM界面、原专项关闭门及虚拟网格七文件：类型25.11秒、265项全通过、无跳过或失败，Vitest8.46秒；普通构建30.45秒、Vite29.74秒，整条CLI退出0、64.7769752秒。

原日志在`.cache/q01-enabled-merged-20261021/`，stdout摘要5ba3a2be4aa18a4943620e31f4581c1980698d1a2283d221da6cc0551ecccb21，stderr摘要b7b49deb47291ec895bb313635131ff90cd6ba86543958be40dcf0272b8b76b4，保留Rollup注释及大分块警告。此为合并源码检查，不是把两项功能合并后的新GUI结果；新完整CI和筛选启停实库范围仍独立验收。

准确main整合提交`c4495066f4f570fbff69769ea377f442c66a0aea`已推送，src树`0eb5a6922e7ecc8ff75b0bdddc1c6e597d25c6d2`。[CI39541666500](https://github.com/zhao-yc/DBArk/actions/runs/39541666500)的Linux job119030571609已success：Python21项、0.304秒，类型／593文件11478通过、10平台跳过／构建成功；单元174.00秒，Vite27.29秒。三平台原生job仍在运行，原生剪贴板job跳过，不先报最终通过。
