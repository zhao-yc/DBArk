# 查询分栏布局源码整合检查点

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
