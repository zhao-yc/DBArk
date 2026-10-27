# Windows 连接迁移重启失败待诊断

`197ef4eb` 的 CI run `40419805227`／Windows job `121911115796`：原源码专项及
首次文件模型通过，legacy 源码流程 80 通过、369 条件跳过、2 失败；安装构建未执行。
两个失败是 `connection-transfer.spec.ts` 第 100、165 行用例，在中途首次重启的
第 126、191 行调用 `quitDesktop`，等待 close 12000 ms 超时。

ego lite 通过页面明确给出的原始日志入口保存完整 job 日志；原附件 `12696783660`
ZIP 的 SHA-256 为 `8e0e35c85418a6d4a51d07cd7899504ea8c0f76e9010542722ed9a92597110bc`，
本地摘要与 GitHub 一致，全部 ZIP 条目 CRC 通过。两失败目录仅有操作成功前截图与
`error-context.md`，没有对应失败截图或 trace；不能据此认定窗口已经关闭。

`desktop-fixture.ts:239` 是 close Promise 的创建位置，不证明执行停在该行。
当前原件没有记录 will-quit 标记是否到达、`desktop.close()` 是否进入／返回、保存
握手 ACK、broker 关闭或原主 PID 的 exit／close。保存握手、返回工作台以及调试会话
退出等不同路径都可能产生此报错，现有证据不足以选择产品修复。

已核对 `8e3938c9..197ef4eb` 的产品 src、两测试文件、package 和 lock 均无差异；
新增常规 CI 的八行只在 Mac 分支运行。前者 Windows CI 已通过，这仅说明不能直接将
本轮失败归因为查询功能改动，也不能据此认定失败无害。

下一步仅为原 owner 增加有界退出阶段证据，单次运行原用例。保留 12 秒门槛、原断言、
实际用户退出回答和失败现场，不加重试或强停，也不以新通过覆盖上述原失败。
