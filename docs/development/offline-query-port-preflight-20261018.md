# 固定离线查询端口预检与原生流水线接线（2026-10-18）

## 固定范围

基线为 Root 指定的 `9c260582e6cb30a7b8b38cd952710695e142a570`。使用普通独立克隆 `D:\svn\DBArk\.cache\parallel-20261015\employee3-offline-query-port-20261018` 和任务分支 `codex/employee3-offline-query-port-20261018`，未使用工作树。Root已有未提交说明及其它成员改动未复制或修改。

本片只新增固定预检脚本，修改源码/安装CI门及安装执行器接线，补RAM与相关执行器测试；不改spec、产品或Root目录。

## 单次固定目标与事件证明

`scripts/check-offline-query-port.mjs` 不接受任何命令行参数，也不从环境读取目标、端口或认证材料。唯一连接是新建的原 `Socket` 对固定 `{host:'127.0.0.1', port:1, family:4}` 的一次connect，使用IPv4字面量，不做DNS查找、探测其它端口、读取认证或重试。

connect之前已经登记同一个原socket的connect/error/close及timeout事件。只有原error报告精确ECONNREFUSED、未曾连接成功、随后确实收到这个原socket的close，且没有其它失败事实，才可以通过。拒连本身不提前放行，不主动destroy拒连分支来替代原close。原close后下一轮事件循环确认前的晚error/connect仍判失败。

连接成功、其它错误、socket timeout、先close却无ECONNREFUSED、同步connect异常均失败。3000毫秒截止时间保持引用，不调用unref；拒连但未close、没有任何终态等情况也在截止时失败。失败清理只destroy本次原socket，绝不合成close或借其它socket的事件。终态释放计时器；原error监听保留以吸收终态后迟到错误，不将失败翻成成功或产生未处理error。输出为固定目标对应的中文结果，不输出原错误message或认证信息，CLI失败退出码为1。

这里的成功证明只对应这一次探测的拒连及原socket关闭，不保证随后一直无监听。Root仍负责实际运行与三平台验收，本轮不声称真实socket或系统端口验收通过。

## CI与安装路径

`.github/workflows/ci.yml` 在源码 `pnpm test:e2e` 之前增加独立 `node scripts/check-offline-query-port.mjs` 步骤；源码和安装两处env均增加 `DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST: '1'`。源码原integration=0保持，不删除或覆盖源码DEV_URL，实际spec已有显式DEV_URL拒绝门继续生效。

`scripts/test-packaged.mjs` 在完成真实安装、验证准确EXE/helper、统一普通及C02同值EXE、强制integration=0并删除DEV_URL之后，仅当该门精确为字符串1时，以当前Node执行同一个无参数脚本。预检命令紧邻真正Playwright命令，子进程预算10000毫秒；失败沿原command异常路径阻止Playwright，不跳过、不回退、不重试。关门时保留原安装执行路径，不做此预检。安装和退出清理逻辑未改。

## 实际验证

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/offline-query-port.test.ts tests/unit/offline-query-port-ci.test.ts tests/unit/test-packaged-paths.test.ts --reporter=json --outputFile=.cache/offline-query-port/tests.json
node node_modules/typescript/bin/tsc --noEmit
node --check scripts/check-offline-query-port.mjs
node --check scripts/test-packaged.mjs
git diff --check
```

37项通过：固定socket事件RAM 19项、CI静态接线1项、安装执行器17项。后者包含原9项全部保留的路径/helper断言，以及8项门开关、两条Node命令相邻顺序、环境归一和预检失败阻止Playwright的对照。旧VM没有缺失依赖，无需删除断言或更改预期；只给测试端口增加新门及合成预检失败输入。

socket测试逐字提取实际脚本函数，只注入EventEmitter RAM Socket、假计时器和CLI日志端口，检查监听早于固定connect、原socket归属、拒连未close不提前通过、晚error、连接成功、其它错、无error close、超时与截止后迟到事件。未导入或执行node:net的真实Socket。37项报告SHA256：`e8da52aaa2a8e9f6a9e5884c5a94bdb4d16e4df9706ed69b761e65c0b673a6e4`。

类型检查、两个Node语法检查和差异检查退出码均0。语法检查不执行脚本。本轮没有实际连接127.0.0.1:1、GUI、实库、剪贴板、安装或本地full/build；Git账户归属核对与同步属于交接操作，另计。

## Git交接

远端核对为 `https://github.com/zhao-yc/DBArk.git`；GitHub连接器当前认证登录为zhao-yc，与远端所有者一致。任务仅在固定9c26058上追加本片文件，不合并Root新进度或混入其未提交改动。推送前核对任务范围及远端分支，仅向本员工新任务分支正常推送，不强推、不修改Root既定分支。新增CI接线的实际原生预检及三平台结果由Root后续运行记录。
