# 查询结果整理历史：Windows源码实库验收

## 版本与执行

本机`D:\svn\DBArk`、`main`准确提交`b4a2220868760d6411d1d488960d8049c2f99995`，src树`55e27dc3e14df113e2032e6d65e28b58476ab941`。最终类型、6文件343项及构建通过，见[实现记录](../../docs/development/query-result-history-20261021.md)。本轮窗口运行未修改产品、原断言或期限。

WIN11-TEST此前新准备在进程创建前被策略拒绝，已明确没有启动或排队回合；按既有授权回退本机，不接续旧c54现场。本轮执行前只读确认没有同名Playwright用例进程。每次Docker在同一SSH先核Server-200／root／IP／socket，显式固定`unix:///var/run/docker.sock`并移除目标覆盖；只读核唯一DBArk/13384容器，凭据仅RAM。用例再核准确MySQL8.4.11／Linux／lower_case_table_names=0／server UUID，只执行原常量查询，不指定数据库，不创建库、表或用户。

命令为`node node_modules/@playwright/test/cli.js test tests/e2e/query-result-organize.spec.ts --reporter=json --output=<本轮独占目录>/results`。保留120秒、retry0和录制关闭；原CLI PID32192，2026-10-21 UTC14:32:00.1517197Z～14:32:16.2827040Z，exit0，外层16.1576085秒。原报告1 passed、0 skipped／unexpected／flaky，retry0，用例14251毫秒。

原件在忽略目录`.cache/query-result-history-ui-local-20261021/`。stdout SHA256为`4c86141b17ddef3f8c25a2d38b5d9bf79a9bf18064fc6a5d81b15109a4bfc84c`；空stderr为`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。入口spec SHA256为`564e100607fe6becaa53c4aa26e6830ab327709003627fae5461ab090498d59f`，真实live文件SHA256为`d0d753b06103afbd7d5415427cb8aa7b5c74c669397104b80cc00c87adf3b111`。

## 实际结果

原整例新增真实点击多列优先级撤销及重做：`1,3,2 → 2,3,1 → 1,3,2`；空筛选后撤销恢复原排序、重做重新为空。其后继续原分组、区间、多值、启停、单元格条件、列布局、勾选和两格式导出。原受管审计最终严格等于queries1、exports为csv/json、pending0、revision0，历史编号未变化，页面错误0。首次网格客户区高度96，原几何／命中读取保留。

Root随后独立读回两份实际文件，未调用产品编码器或验收助手生成期望：各2行，id依次1和3；精确大整数、小数、NULL、空串、二进制、重复列名及列序逐项一致，隐藏哨兵未导出。CSV SHA256为`a8d7e0d2949aec1d5ba342b1cd6bb9c30d98901c1edacbb17fc021c5a8cf9048`，JSON为`fd0979ab54e513de5b565d11a2dfa1174cccc4b18393a8d338b813c26aeb4678`。文件保留在本轮忽略目录，不入库。

原任务门确认一条查询及两个导出全部完成，原App正常退出；观察连接通过捕获的同native／同stream严格关闭及`closed=true`门，原afterEach与fixture收尾均通过。没有新建数据库资源需要清理。复制使用原合成ClipboardEvent的RAM DataTransfer，未操作系统剪贴板；文件选择及退出采用原受限接口答案，不当作系统键鼠验收。

## 范围

本机Windows开发Electron／MySQL8.4的真实窗口整例与独立文件读回，不是VM、安装版或macOS证据；其它版本／驱动继续。旧失败保持，不增加完整工作包或发行计数，暂不发布。
