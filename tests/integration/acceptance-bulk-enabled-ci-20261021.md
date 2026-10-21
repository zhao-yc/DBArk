# 批量启停源码及后继用例的 CI 分层记录

## 准确 b61 源码

[CI39546340655](https://github.com/zhao-yc/DBArk/actions/runs/39546340655)，HEAD `b61b19271ebd213fa22e9f65040f70e34e356b7f`，src `97162ea158e662ab09b8b25c97ecad1b563c3cef`，四个实际检查job全部success，剪贴板与发布跳过。

Linux job119045264388：Python21项通过／0.189秒，类型、593文件11481通过／10平台条件跳过、Vitest147.55秒及构建成功，Vite24.12秒。Root读取准确job原日志。

| 平台／job | 原源码legacy | 同job实际安装legacy |
| --- | --- | --- |
| Windows x64／119045264213 | 80通过／317条件跳过，7.3分钟 | 80通过／317条件跳过，7.3分钟 |
| macOS x64／119045264299 | 80通过／317条件跳过，8.3分钟 | 80通过／317条件跳过，8.1分钟 |
| macOS arm64／119045264302 | 80通过／317条件跳过，6.8分钟 | 80通过／317条件跳过，5.7分钟 |

上述为job状态与原日志摘要；本记录未独立下载新成功ZIP复算原report／accepted／owner或显示租约，不冒称完成该层审计。该CI离线安装不包含三门默认关闭的私网批量筛选整例，也不证明本机公开安装包验收。签名／公证及发布不在本轮。

## 准确 300 后继

[CI39547268906](https://github.com/zhao-yc/DBArk/actions/runs/39547268906)为准确 `30055118eb1261dea5fef6f3e94261a3e31c373c`，同src树，扩展专用GUI及操作单。Linux检查success；Windows119048166359原源码legacy为79通过／1失败／317条件跳过，exit1，安装阶段未执行，不能因b61成功改判。

失败在 `page-find-replace-offline.spec.ts` 第103行用例的beforeEach第26行：等待“当前页查找替换”按钮30秒仍不存在，尚未进入本例正则断言。原日志与error-context没有足以确认启动根因的早期renderer／load记录，不将其直接归类为随机失败。

Root下载准确测试归档12321987469，2668609字节，SHA256 `62ad869aba532bedc6e174b991a8f2f0f7d3077892f1cdeaaf23c4108890a6b1` 与上传metadata一致；71项／解压总量预算内全部CRC通过，读取原error-context，没有执行归档或重跑job。原件在`.cache/bulk-3005511-windows-failed.zip`，不入库。系统PATH的Python为不可启动的WindowsApps别名，改用bundled Python；首次控制台GBK编码报错保持，UTF8重新读取原件不改内容。

本条记录时其它300平台终态另记；其WIN11-TEST专用[批量GUI原失败](acceptance-query-result-filter-bulk-3005511-20261021.md)为不同失败和资源范围。后续修正须保留原断言与旧失败，不通过跳过／提高超时／降低门槛收口，暂不发布。

后续核实300的macOS x64 job119048166186及arm64 job119048166292均success；Windows仍failure、发布跳过，没有重跑原job。新[离线启动诊断](../../docs/testing/page-find-startup-diagnostics-20261021.md)只补证据，原根因仍未知。
