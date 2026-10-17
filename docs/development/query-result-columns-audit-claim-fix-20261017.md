# 结果列准备门：session单次领取修复

固定基线为a7bdddb4ce92e5089ac836600dc0d26365c013fc，独立普通clone分支为codex/employee2-query-columns-audit-fix-20261017。只修改专属审计helper并新增本专项测试及本文；不改产品、共享fixture或正式执行入口，不启动正式UI。

员工1报告review.json的SHA256为5b1c630d6c659c542fd03eafc0c7e7cc75a036015f7c011fdb3d6db0ae03af95。缺口是首次sessions.open仍在await时，state.session尚空，第二次可以被原handler委托；倒序回包可覆盖session且审计不失效。正常产品QueryTab已有pendingSession去重，本片只修验收防护门，不声称发现或复现了真实UI重复建会话。

首次准确sessions.open在调用原handler之前同步写入不可回退的sessionClaim。任何重复请求先永久停链，不委托第二次、不清空claim重试。claim保存原sender、profile、revision及真实原回包/返回sessionId；原回包抵达时先留存，再核同claim、原sender/profile/revision/handler和原期限。失效后回包不能成为活动state.session，原session和晚到资源留在原claim中，既不覆盖也不补关。

本片不把claim或回包加进readQueryResultColumnsAudit的对外输出，原读状态仍只有查询/导出计数、pending和revision；不增加认证、SQL或路径输出。失败保持现场，不借finally清理资源。

最小三组RAM对照仅运行新增文件：正常一次及顺序重复、并发重复与倒序回包、handler失去归属后的晚到资源。完全相同字节的测试在原a7为1通过2失败，修复后3通过0失败0跳过；测试文件与原红封存副本SHA256均为61a949c9b756a19b8f625c8566c6cd04e68de88d917afdd7fa04551a028f6f95。

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/query-result-columns-audit-claim.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/query-columns-audit-fix/fixed.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

本片没有重跑原37项、全套或构建；没有GUI、DB、实际原生IPC、文件导出、系统clipboard、SSH、Docker、安装或私料读取。Root尚未整合a7，正式UI仍不启动；本专项通过仅证明RAM审计门拒绝重复领取并保留原资源归属。

本次TypeScript类型检查实际退出码为0；源码与专项证据在独立clone内保留。
