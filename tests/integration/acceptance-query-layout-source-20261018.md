# 查询分栏布局源码整合检查点

修后固定`f574c15bcf6104046af58e1a6df3e5dbf7ca016d`完整CI39091562766/job117569232931已成功：491文件、9099通过、10条件跳过，类型及构建成功。解码原文日志`run1687-f574c15-full-ci-green.log` SHA256`6c3579f6e479d47283b4eafad6e06fad34e17747d12308dca3429c90a0d40e90`。桌面/发行job跳过，下述三个真实平台失败仍保留；原生阶段诊断与新检查点继续，不能将完整单元绿当作安装验收。

## 三平台原生CI首次检查点与有限修正

有限修正后固定a0dc58e的完整CI39091280341/job117568380440首轮为491文件（490绿/1红），9093通过/6失败/10条件跳过；类型通过、构建未运行。失败集中于query-layout-native-gate旧VM未提供新增纯窗口模块，以及一个仍期待原内联setContentSize文本的接线断言。Root`0cc2a72ae075a28190c5f18a24d5870291e028a8`补真实纯模块，窗口接线同时核spec实际调用和helper实际setContentSize，保留原无资源、期限、录制、schema8、退出及种子断言。原失败文件一次8项通过；未改实际专项、产品或原生门，修后完整CI继续，原6红保留。

固定3d7c73e的完整CI39088982989/job117561439268已成功：490文件/9091通过/10条件跳过，类型及构建成功，解码日志`run1674-3d7c73e-full-ci-green.log` SHA256`005f65a96b2eafafc6705c2e5644984b81e70088ba4dad7f0ac52048254d7202`。只加运行标记的9e530da检查点触发CI39089165148，Linux job117561971255同样490/9091通过/10跳过、类型及构建成功，日志SHA256`d67b7af4d41e00cb14feff6ea7413ae4e77dcaade231c35e349eca6904e058ed`。

该次桌面验收全部终态为失败，原件保留：Windows在源码缩进的只读预览后收到了pageerror名称Canceled，报告SHA256`8b26275efaad117b7e1627e76e28293a65a421af347e16a7cef46d9cb3cf48c6`，原记录缺少message/stack，生产原因未确认；macOS arm64源码缩进通过，但分栏初始maximum为226，未达到原`>410`前提，报告SHA256`f2299566f40eb982011ffa8c8c2f71437174ed5e0de3319bf9a360f67d143231`。不能将这些失败改写为已验。

macOS x64的源码缩进和分栏各单次通过，原报告SHA256分别`4b58138101bf60a2b3578809c4b9b49593c5154edd89e7dfcb22a976013e7490`与`ffd45a8ad557353a225bac2d457d778d030432055fcd5af1fbfa7dc851e5a20d`；Root只读重消费两份原JSON，两个owner均有原正常退出/PID和清理证明，没有新增GUI。随后真实DMG安装成功、字节封存后，安装缩进单例120秒超时，另worker teardown45秒超时，未得到原owner失败附录或通过证明。安装报告SHA256`23e1470b76f20a6e516e05271035cc86b0ca149d004dc32c2c88e01b5595a17a`，原现场保留；安装后分栏未运行。

员工c41c1f8对应Root`80051457aa6944519be66e3c148b6d5311171c38`，仅修改测试场景与错误诊断：从实际BrowserWindow内容尺寸固定缩放，通过官方zoom建立原CSS场景，原410、拖动高度、短屏和模型/持久化期待保持；css字段是content/zoom换算，真实DOM几何仍由原断言核对。保留原errors拒绝门，额外记录原错误message/stack，不过滤Canceled。作者8项、独立5项RAM对照通过，独立交接SHA256`7272e512f33059c9b5a09a3162fa1148e5b6d4bb287852a0dc9755dad81fdb2c`。

Root固定8005145的5相关文件97项通过，类型退出0，日志`run1679-native-scene-integration/stdout.log` SHA256`962c3a80c509e7752212fb587b21b0028d9fb343ac41430b76c7f5301eb6cd58`。产品src、构建脚本、版本与锁未改，未重复本地构建。新原生检查点待运行；本片不声称已修复Windows实际Canceled或macOS安装超时，0.23仍未公开。

日期：2026-10-18。固定Root `2b7635211dd29193ca6b33b81fe29ccd392bd66e`，分支 `codex/p0-query-layout-v023-20261018`，0.23.0开发中，SQLite配置库8。独立普通克隆，不使用worktree；未改0.22候选或主目录。

真实QueryTab已接入指针/键盘分隔条，逐查询标签持久化编辑区高度；旧值缺省300，严格写入130–8192整数，只保存显式提交。可见高度按工作区收紧而不改偏好。取消、失去捕获、Escape、卸载及目标变化会释放手势与租约，迟到事件不回写；提交只合并最新当前标签，保留SQL、标题、关联来源及其它标签。

作者后端0eee9e0/731c5b0分别对应Root7945546/9826bea，renderer5eb3677对应Root0285da0。schema7→8沿既有事务迁移；新字段不访问远端、不添加命令或依赖，不读取凭据明文。坏值读取只规范对应返回对象，不因读取自动写盘，未来9拒绝。

作者后端97项及renderer30新项/52相关回归分别保留原来源，不相加成唯一全量数。独立renderer审查新增1项真实React跨owner对照通过，42个原函数及两个SqlEditor元素保持，交接SHA256 `fc29264d5d9b7426b939c4a8341bf7b9a4aff67278b520be9d25459c7fbfec4d`。这是真实组件加合成DOM事件，没有OS指针或实际Monaco布局证明。

后端独审发现一个P3：导出schema单独解析会把继承高度转成自有，当前Main/直接存储的原始门仍拒绝，未证明写盘绕过。原1红报告保留，SHA256 `224bf998e398a688de6c89e5e8b9236f11cd43a18201cd1c84d00077e8530fad`。作者a4bed7c对应Root4bc9f15，在解析前检查原对象；作者6项及类型通过，原审者原反例与必要对照5项通过，复核SHA256 `c5cff2f6d66c215a4eb5833cf094125e481a6594d2d340408df53c8b47015235`。341处旧断言静态数量保持，不把数量保持当复跑结果。

Root固定2b76352的16个相关文件一次133项通过，无失败或跳过；一次类型检查及新源码构建退出0。使用最小OS环境、envDir=false，不加载项目.env。日志：

| 记录 | SHA256 |
| --- | --- |
| `run1618-query-layout-integration/stdout.log` | `378e740a71eeda63ec8178ba5a77676c751101e8eae39f9c4445818b40981cc9` |
| `run1619-query-layout-build/build.log` | `debf492af4893f8a43f21c3de99a207c9e35e7a4c8d494194b5583dc8ab84983` |

本次没有跑完整套件、真实GUI、重启、安装、服务器/SSH/Docker、系统剪贴板或数据库凭据。新增布局源码不继承0724/91e3的8824完整数或三平台安装76统计；基础fa63444的新完整CI另有旧只读DDL呈现用例一红（8936通过/1失败/10跳过），原日志保留并独立定位，不能冒称本版全绿。0.23完整检查、正式窗口/重启、安装及平台矩阵继续，尚未公开发行。

## 随后完整CI及旧夹具修正

固定 `50e589088fc6cb0485b0745069c9a8156e07d347` 的[完整CI39080659541](https://github.com/zhao-yc/DBArk/actions/runs/39080659541)、job117536738985全部成功：483文件、9000通过、10条件跳过，类型及构建成功。原日志 `run1624-50e5890-full-ci-green.log` SHA256 `2571fb82dc0992ccb6e98789c6f78193e968fa14ed5f326c10a02539ade35cd1`。桌面job条件跳过，不提供原生或安装验收；该9000不包含随后测试夹具修正。

原fa63444唯一红仍保持：旧RAM textarea缺少defaultValue反射textContent，ReactDOM初次挂载因此未从默认文本初始化value，后续render可能掩盖它。作者固定Date.now稳定复现空value且完整DDL已在defaultValue、readonly和拒绝原因已呈现，以首次/同props再提交因果对照确认。没有通过增加等待、强制render或编辑器noop追绿。原日志 `run1620-fa63444-full-ci-original-red.log` SHA256 `946aebe837d932cbdd1ddda766910181d7e579e4c424f828a9ad58857fe6d033`。

作者70eaead对应Root `d035b09e95e93fe8df1cdc2e15090008c3beb69f`，仅在该测试factory补浏览器默认文本反射、固定原红时钟并加只读/拒绝路径检查；63处原断言逐字保持，无产品改动。作者正式窄测3项、因果1项通过、类型一次通过，交接SHA256 `5f8f504ade04401c2c97765486dd480534749286cdfde182cd52f85767755588`。Root受影响完整文件一次22项通过，日志SHA256 `0d4cd8fedc0e00e6c68bcd71a1100ff4fdab0f966c686f1e1d78e7da983e53d0`；相关产品文件与fa一致，不重复本地类型/构建。原红、50e完整9000及修后22属于不同来源，不改写或累加为同一完整终态。

固定 `ddd9a8fde08f458964313a7677158b0647802860` 的[新完整CI39081092814](https://github.com/zhao-yc/DBArk/actions/runs/39081092814)、job117538002267随后成功：483文件、9001通过、10条件跳过，类型及构建成功，包含上述textarea夹具修正；原fa失败仍保留。日志 `run1628-ddd9a8f-full-ci-green.log` SHA256 `0c57e1937a8770ad1b993afd3e1a555ba0c99f346dea5efb365c9a12e7c3ab5c`。桌面及发行任务均跳过，不计作安装、原生GUI或公开发行。

随后本分支前向接纳了原生准备器的作者ae800bd/557344a，Root对应9665d97/8b800f1；五个runtime/owner/gate/identity/相关测试文件与已验0.22来源逐字相同，SQLite预期仍为本分支的8。产品、脚本、包、锁及工作流与ddd9a8f未变，未重复本地测试/类型/构建；本测试代码增量不继承前述9001完整结果，另需新CI。0.22实际两次尝试、PID独审及已知键盘种子问题见[专用原生记录](acceptance-p0-native-preparation-20261018.md)，不外推为0.23布局GUI。

## 4576920完整CI与新专用准备

固定 `457692009dbe4363acc7d61cc877c1063c5ea23d` 的[完整CI39081966664](https://github.com/zhao-yc/DBArk/actions/runs/39081966664)、job117540590742全部成功：483文件、9022通过、10条件跳过，类型及构建成功。原日志 `run1636-4576920-full-ci-green.log` SHA256 `7ea1bcf9a98098e0dd04d442cb6166f4e91bb83474a9afab331d944ef3fb99a8`；桌面及发行job跳过。该数早于后续种子、退出句柄、动画观察和分栏专项增量。

本分支随后接纳c99bec5/5b01ac4/66ae342，保留私有退出阶段与本分支SQLite8预期；它们在0.22的原失败和实际通过分别见专用原生记录，不将0.22通过算作本布局验收。作者cfe2a75对应Root `1ebf0d97902808e795418c9a752e25deb915052a`，新增独立默认关闭的分栏门、单个正式spec及factory可选批准清单；不伪造旧缩进门，不新增launch/期限/清理规则。

独审6个唯一RAM对照通过：新门、迟到返回停链、显式清单与旧无参factory、原键鼠函数驱动真实Splitter/Lease，交接SHA256 `510ac63580b5e2a9cd5b14b0aff1b33ad9e2612d460ba0183f3215aeea7b1746`。Root合并后新门及共享runtime三文件65项通过，类型退出0；日志 `run1640-query-layout-native-integration/stdout.log` SHA256 `c89ae4c763fa009ba9704ba870897b2bee9992c2c609c8868228e6eed9c07ee9`。

## Windows源码分栏专项通过

产品src/scripts/package/lock与已成功构建的2b76352逐路径相同，没有重复构建。Root为本分支固定独立112文件编译清单，SHA256 `b754a96fd557585e00adf45ec04d40d7a3235a3f6b0e506a46e49f3caa834f8f`，正式每次启动仍核入口、全树及实际主进程/窗口来源。

run1642固定1ebf0d9，在获准的沙箱外环境只执行一个正式Windows源码Electron用例：1通过、0失败、0跳过、0重试，约18.1秒。真实鼠标/键盘将A标签300→360→370、Escape取消不保存、恢复默认300；B标签300→340→390。切换保持各自高度和原模型/编辑器，正文/非空选区与真实Undo/Redo保持；缩小窗口只夹取可见高度，越过650毫秒防抖后完整settings不变，恢复窗口仍390。

第一次正常退出后，独立读取SQLite8并逐项核标签/活动身份；第二个独立应用恢复A300/B390和原SQL。两次owner均confirmed/willQuit/closed=true，分别记录6及5个PID；原runtime确认全部消失后移除本例目录。终态directoryRemoved=true、schema=8，任务/历史/保存查询列表为空，无页面错误，SQL和系统剪贴板操作为0；未读取数据库凭据、连接200或运行安装器。

原JSON `run1642-query-layout-native-source/stdout.json` SHA256 `3ffa15ad22a93611a86a3e1592ccb49f2c61d00eeb62c80592de57a4bc273997`。以上是本机Windows源码专项；当前头完整CI、安装包及macOS分栏专项仍待验，尚无0.23公开发行。

## 三平台源码及安装专项接线

作者d778fc7/577696a对应Root`7a933aa`/`f0a7c79a8c4d8c4218ebbd52093c57b586ec4a12`，将原缩进、分栏spec接入同job成功构建及真实安装后两阶段，各自独立门/子进程，仍复用原期限、owner和退出/PID闭合。安装输入先封存；安装后对实际app及同job打包参考核字节，NSIS不能充当app入口。失败不重试，不卸载/删除保留现场。

独审发现原P1：后续普通Playwright默认清空test-results，会删除原批准/专项证据。原1红1绿保留，修复后源码/安装普通回归改为独立子输出，旧默认调用兼容；原审3项通过，交接SHA256`e60438fcbddfb98f5f6008842880244cccb1bc5733ac89d5f0c004624856b7ab`。Root1651仅用两个已保存原生JSON核新consumer兼容，两项通过，未新增GUI。

Root固定f0a7c79的5个相关脚本/端口/安装路径单元文件46通过，类型退出0；日志`run1656-native-ci-integration/stdout.log` SHA256`6d89c9fa179d4060214c735558068a36b725f8af7eaab228e5119ef9e815c0a2`。未重复本地build，产品src/版本/锁未改。新CI/三平台源码及安装的真实终态尚待运行，接线和RAM检查不算12份专项证明，见[运行合同](../../docs/development/offline-special-native-ci-20261018.md)。
