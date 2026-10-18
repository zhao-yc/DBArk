# SQL关联保存POSIX真实mode补验入口

父提交 `3593a06a87845a12cd43797d24017b0da182148b`。本片只新增一个测试身份，不修改产品实现。

`tests/unit/query-file-source-mode-posix.test.ts`：只在POSIX执行；真实文件放在当前clone的 `.cache/sql-file-mode-posix-tests/owned-*`，用wx创建后先chmod0664，调用原 `readQueryFileSnapshot`，再把当前fork的umask设为0077并调用原 `writeBoundQueryFile`。替换后通过真实stat逐位比较 `mode & 0777 === 0664`，核对返回mode、文件字节及写入标记。finally无论失败与否先恢复原umask，再核目录归属并清理本例创建的目录。

建议Root在后续Linux CI的独立fork中只运行：

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/query-file-source-mode-posix.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
```

当前宿主是Windows，本轮只选择此文件，结果为1项条件跳过、0项执行；没有新增POSIX或macOS实测结论。前片五项RAM结果不变，本轮未重跑五项/127项/类型/完整套件，没有GUI、外部用户文件、网络或推送。
