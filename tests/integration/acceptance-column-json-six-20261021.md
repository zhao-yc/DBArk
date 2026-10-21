# JSON字段：六组合真实Engine验收

## 来源与控制

本机Windows／`D:\svn\DBArk`，候选基线`0e488b77c2ff0ad186bddbdf7c49990d579ec10a`，产品差异SHA256 `89f15ece76c9844fa0c6e86b3a059eabfeccaedef58d35042c86d8dd7fcc310e`（PowerShell对`git diff HEAD -- src | Out-String`的UTF-8字节计量）。全六组合前后同一差异，不在运行中改产品。最终integration用例SHA256 `0d6b31e37d8e0a5a2884e587871c0f4a83d65132e756eeb1801b638507e0a87f`。

每次Docker在同一次SSH先核Server-200／root／IP及socket，移除目标覆盖、显式`unix:///var/run/docker.sock`，只读inspect唯一DBArk容器和准确端口。既有认证只留RAM及子进程env，不落盘、回显或放入argv。用例再核容器hostname及端口对应的实际版本／方言，13484明确严格TLS及既有CA。只建随机`dbark_jsoncol_*`库，不改全局模式、用户权限或业务资源。

串行命令`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/engine-json-columns.integration.test.ts --reporter=json --outputFile=<各自目录>/report.json`。只旁观真实connect工厂，原参数／原函数仍执行真实网络并返回原ManagedConnection；捕获其原线程及只读资源facade，没有替换服务器回包。每组合30秒，失败保库并停后续，成功精确清理。

## 最终单次组合结果

日期2026-10-21，时刻为UTC；每行1 passed、0 failed／skip，exit0。

| 端口／实际版本 | 原生PID | 开始～结束 | 外层秒 | report.json SHA256 |
| --- | --- | --- | --- | --- |
| 13357／5.7.44 | 32476 | 15:50:51.5589992～15:50:57.5600115 | 6.016 | `21db7a896a6666d5b5ad22ac8ca931af7d4b66867a852159aa7153976723038b` |
| 13380／8.0.46 | 47840 | 15:50:57.9815475～15:51:03.7383670 | 5.765 | `7ee455f478505deba10b077f42f66b3b63ae6bb0904e0e6650d99364448d8141` |
| 13384／8.4.11 | 22284 | 15:51:04.1071319～15:51:11.3762036 | 7.278 | `65d75d940d693f5e02e5acfb3c00957a6f817882ce7eafe132c866da27dc28db` |
| 13310／10.11.19-MariaDB-ubu2204 | 66156 | 15:51:11.7602933～15:51:17.2162581 | 5.464 | `52e91e96ac776b194c66ca2fcdfddf1701062d5f779a54fe120b034792f8ed6a` |
| 13311／11.4.13-MariaDB-ubu2404 | 11520 | 15:51:17.5934902～15:51:23.3766506 | 5.792 | `3fc8e585bdb3a638bcc1a9050a6f778d2a3b4c530080dc39ca480d7ee474e934` |
| 13484／8.4.11，严格TLS | 25232 | 15:51:23.8587114～15:51:31.6453148 | 7.795 | `645a8d9b5161ebc2faa5260bb2b47df5b114c069a22249de954f9918d59cdb2f` |

精确起止、原库名、13条原线程和各资源关闭状态保留在`.cache/json-columns-integration-evidence-20261021/<端口>/{start,result,evidence,report}.json`。每组合两个表（general_ci／bin），共12个新增字段、12次有效JSON／非法JSON测试；不把同一用例的六组合算成六条新功能。

## 实际行为与边界

拒绝JSON字面默认值的预览后定义不变；正式预览也零DDL。单次ADD返回`ddlCompleted=true,definitionVerified=true`，原行和旁列保持，原记录新增JSON值均为SQL NULL；重新读取仍识别JSON。实际写入大整数及精确文本JSON并独立SQL读回，非法JSON写入被服务器拒绝、失败行未出现。该精确小数是JSON文本成员，不声称MySQL原生JSON数值保留任意DECIMAL精度。

Engine关闭后先核所捕获的全部非管理资源终态，再精确删库；新连接复核库及原线程缺席，最后13条资源facade均`confirmedClosed=true`、分配已结算、pending0及inventoryUnknown=false。全六组合78条原连接确认，六库已清理。首轮通过及其摘要未输出情况单列保留于`.cache/json-columns-integration-20261021/`，不追写原报告。

以上是本机真实Engine／数据库证据；GUI、utility process、安装版、macOS及完整类型转换尚未由本轮证明，另走固定提交原生专项。暂不发布，不增加完整工作包计数。
