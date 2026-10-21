# 批量启停首次 Windows GUI 失败记录

准确HEAD `30055118eb1261dea5fef6f3e94261a3e31c373c`，src `97162ea158e662ab09b8b25c97ecad1b563c3cef`。WIN11-TEST回合 `01a15cbc-93a9-77b0-9a11-2a5ef0d26d1c` 已completed，不重新启动旧任务。

准备原CLI1380 exit0、118.482秒，四文件147通过／0失败／0跳过；类型43.79秒、测试16.00秒、构建58.24秒。正式GUI CLI9720创建北京时间13:16:57.007044，exit1、18.184秒，1失败／0跳过／retry0，stderr为空，独立读回未启动。

失败在用例174行 `expect.poll(ids).toEqual(['3','6','7'])`：真实点击全部停用、确认两草稿未勾选后，70行调用原网格读取器即抛几何错误，尚未比较ID。最后成功 `grid-order-30` 为3／6／7，没有order31。原layout31为viewport1428×860，grid top783.4285888671875、left273、width1147、height96.85714721679688，clientHeight89／scrollHeight136、aria-rowcount4；editor高度0、splitter minimum／value为0／0。原96客户区门保持。取消、嵌套分组、递归应用、复制、两导出及Python均未到达。

48条进程身份、43个PID候选终核零匹配；严格App／观察连接native／stream正常关闭仍unknown，不据OS缺席回填成功。原profile `C:\Users\tester\AppData\Local\Temp\dbark-e2e-KS2aGm` 保留且未读内容，新nonce目录保留、两输出不存在，未强杀或补清理。最终源码576／测试1314／dist109及Git干净，十二套旧封存和两组旧导出未变，父RAM三项保留；251文件逐项SHA及已知敏感值扫描通过。旧误输出事件完整暴露范围及用途仍未知。

封存目录 `C:\Users\tester\Documents\Codex\2026-10-20\hi\outputs\result-filter-bulk-enabled-vm-20261021`：

| 原文件 | SHA256 |
| --- | --- |
| result-filter-bulk-enabled-report.json | 597560cb8b74b137c2158cbdf12f74723824011eb4232d94a038449c169bfb15 |
| SHA256SUMS.txt | 6d0f5598c441d7ef3d3559b1fb143b38da3b70afd31691b95d8cabcb6c799a41 |
| gui/gui-original-stdout.log | ac5b7eb312269c50f7be7043854d8bd1d283737cf1ab60b0bc547ef6b2c779f3 |
| attachments/grid-layout-31.json | ddeaa0c5bc41641ded2f2ec81c4e7df3ce3c2b5113e2e273f1d81036673759d1 |
| attachments/grid-order-30.json | b3ead954a02265f375a03109de4faf3a9f415300c85b1dc01eda8e5c890ef92d |

Root已读取原阶段及最终回报，未下载VM251份原件复算。后续[滚动条空间修正](../../docs/development/query-result-filter-scrollbar-20261021.md)另验，不改写本失败或前序c449成功。暂不发布。
