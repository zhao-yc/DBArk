# 当前源码 Mac 关键字专项验收（2026-10-28）

## 原件与候选

原冻结Mac失败保持[原记录](acceptance-v028-keyword-20261019.md)：run39265643127／job118104387921，产品bf08645a28fceb5d1d40ba16f013bb78e7a7c0a2，测试头eb171c2aea239f10ab170cbc8f47318fa12bbe64。Root本轮回读GitHub连接器解码日志，确认重启后原spec183→103、5秒正文断言及mixed-case实收相符；根因未证明，不重放旧job或补清旧owner。

新候选基线efc92dcd6434eadabd65b61a71ee613551c6bd5d，仅新增工作流、当前源码运行脚本和RAM守卫三文件，产品src、package、lock及原两例不变。源码包171556字节／5项，SHA256 `6ad6558f92bcfb6ca8a73cda8acf563a45fb122951e759738a9f4bc9c9ec926a`；另附2812项运行基线，748651字节，SHA256 `0fc824c5041aa2ea123b3be7dae427d03ba5c8b9d6eec2b199a5ccff3070e5fb`。不得将两个元数据文件写入VM仓库。

WIN11-TEST先核上轮终态、source116／dist109及其他dirty，三新路径须原不存在；限定应用后冻结source119并只读比较全部运行基线。仅`node --check`、类型检查及新旧运行器两文件unit，若已有YAML解析器可用则解析新工作流，不安装工具或运行Mac入口。产品未变，上轮完整19414／1平台跳过不为重绿重复；本轮通过只证明运行器预检，不能替代原生Mac。

实际预检及新run结果待原件回读追加。本机仅代码、Git和原件审阅，不运行产品测试；不读数据库认证、创建资源、Docker、系统输入或剪贴板，不安装／发布。两组CHECK隔离资源仍等待既有授权问题回答，与本专项无关。

WIN11-TEST实际Node语法PID13692、类型PID13592、两文件unit PID18168均exit0，46项通过。原件1723674字节／202项，SHA256 `11ef4b9af526fcc60e7cd8401a55ee1b3bea413a09f7e616d1edd54a338b0acf`。Root核CRC、逐项哈希、路径／私钥块、三门原日志及退出码，source119与前source116＋新3及本地逐字一致；2812项为2786 raw相同、17原LF-only、9验收Markdown缺少、0实质差异。dist109及旧dirty保持；未完整unit／build／Mac入口。Python缺YAML模块，明确未解析、未安装依赖。

Root另下载旧artifact12192148660原ZIP：44098字节，SHA256 `24105dab20523d3dc0256e09a8f08b6d4f873796f14f1102ab327c2b070c8e02`，13成员全部CRC、路径／私钥块、原准许d519d90c…、113清单9077db7b…及原报告SHA256 `8dc14b60b5bc28d0a06e4a72de40bf0795999047bbc4b0227f15739f7ca28ebe`均匹配。原stats expected0／unexpected1／skipped1／flaky0保持。当前原spec及playwright.config与旧产品相应文件无差异，不以预检覆盖旧失败。

## 实际 Mac 运行要求

必须新GitHub-hosted macOS arm64、准确当前main／workflow／job／首次attempt；实际OS和架构逐次记录。原回环预检、同job type／build成功后才签本次完整运行字节，准许及manifest前后重核。保留原两例、原5秒／120秒、单worker、零重试，trace／screenshot／video关闭。不得调用原六专项、legacy、安装或旧artifact消费者，不降低原显示／输入／模型／退出门。

完整原进程状态、报告、准许、真实清单与终态附件缺一不可；绿色step、无残留或托管VM销毁均不替代四个正常owner和原目录清理事实。失败保留原件，不能把观察超时当作终态或重放理由。通过也只覆盖当前源码的CDP格式化快捷键和工作台恢复，不覆盖系统Cmd+S、安装、Intel、其它Mac流程或旧冻结产品；暂不发布。

## 新Mac实际结果

测试头`8c85cdd322b0f36409b504257c36788886136b01`，[run40622537303](https://github.com/zhao-yc/DBArk/actions/runs/40622537303)／job122599736395终态success，首次attempt1。实际macOS26.6.2（25G83）、darwin arm64、Node24.22.1、Electron44.7.0、Playwright1.64.0；image macos26／20261021.0445.8。原回环预检、同jobtype／build及原Playwright进程均status0、signal和errorCode为空。

原upper26.0秒、lower12.7秒，完整报告共39.7秒，expected2／unexpected0／skipped0／flaky0。两个case各仅一result、retry0／timeout120000；原5秒正文断言、单Undo／Redo、模块迟到撤销、SQLite9、保存的活动标签／唯一可见pane／模型／正文及独立重启均由原完整用例验证。四个owner的confirmed／willQuit／closed均true，各case记录PID数量5／4，目录均已移除；模块门每例held1／delivered1／detached true／failed false／contextRoundTrip true。附件声明systemClipboard0／sqlExecution0，本轮未操作系统保存键。

artifact12788082342为35901字节，ZIP SHA256 `4a5080257ee5cb0f04abc499f2764b0d028f010fc2c0d25f99eed8c09bac5fb6`。Root本机独立核全部36项CRC、路径／私钥块、原进程状态及完整report／附件：报告SHA256 `aceeeb4bf431210b6e51618b2024dcdfec9f3c19e5b4bfe46fc98d6e590f53e8`；准许SHA256 `19c46d286d1a6bc08c53b0516bb8447179c2f277d49ddb116126f6537c69bc97`；113项清单SHA256 `93fb1f6692c661e504869611005ec0c8b8b2298e4235d4741284971bce9ba0b2`，与独立keyword清单原字节相同，前后准许重核通过。raw type／build日志与producer记录匹配；产品src tree为`c50b50c9f9de733610455d2d2b85e29409e2e964`，package／lock对象及原spec SHA均与Root当前相符。

原spec／config、owner／runtime、keyword环境门及identity producer与bf对应文件无差异；共享case期限守卫此前改用原框架单调时钟而未延长120秒，本轮未修改该守卫。当前源码专项补验通过不证明旧失败根因，也不重新标记旧bf的Mac失败，不外推旧安装、系统Cmd+S或Intel。源码、预检和Mac原件索引见[机器证据](../../docs/development/sql-keyword-current-20261028.evidence.json)。暂不发布。
