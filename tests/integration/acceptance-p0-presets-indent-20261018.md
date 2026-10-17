# 命名筛选方案及SQL缩进高频整合检查点

日期：2026-10-18。产品固定 `f2bcde30b777d73d42366b0cf7c9f1dc2bc47178`，分支 `codex/p0-workflows-v022-20261018`，版本0.22.0开发中。本批不是公开0.21源码、安装包或其原生用例通过数。

## 实现与整合

- 命名方案作者 `5329f02ca3b4a777ed127248050794ea85f4d271`、窄修 `b889dabeb6176e085fb630dcfa9f322ede251af5`，Root分别为 `3d8caf355b00f57469adb7aa279f9989dc502002`、`421ab952af2fb427252b2f54067606db64233174`。只显式持久化平面条件、all/any及排序；名称、20项单表、500项/目标、单项64KiB及总内容4MiB有实际预算，4MiB不代表SQLite文件或堆硬上限。连接/库/表、真实窗口/文档、连接修订及表级CAS共同绑定；list纯本地，apply使用独立utility元数据任务并严格等待取消结算，不读取表数据或执行写SQL。恢复条件后原表页会正常读取数据。细节见[实现合同](../../docs/development/named-table-presets.md)。
- 缩进作者 `82c3cbff46f6019a1ea0c3ab7a5bd60ba572eb65`，Root `4ef7af646cc97b9fbe2871cf2b3b11831c8d5ea2`。设置与模型、显式格式化均接真实入口，兼容读取局部回退且严格拒绝显式坏值，正文、只读桥接、Undo及布局保留。细节见[实现合同](../../docs/development/editor-indentation-20261018.md)。
- TableTab仅一处同一JSX行冲突：精确保留原批量复制按钮，并嵌入命名方案组件；除该筛选组件替换，两侧公共块逐字节一致后才解决冲突。原冲突文件在私有ignored证据保留，未丢弃批量功能。
- 配置库7来自新增命名方案表，缩进本身不升版本。六份旧迁移夹具只同步当前7/未来8的版本常量，原内容及原文件字节保护断言保持；E2E版本期待仅更新，未执行。缩进独立基线为6，Root另在 `f2bcde3` 将两处新存储期待同步为整合7，没有改产品迁移保护。
- Root将Main发布/来源、方案及缩进共12个关键文件与对应作者固定Git blob逐一比对，完全一致。Main/storage、contracts及validation的跨功能接缝另由相关测试及类型检查覆盖。

## 原失败与独立复核

命名方案初版作者71项及类型通过，未跑完整或GUI。独审后台15项为13绿2红，属于一个P2：helper已返回后，Main最终发布仍可能接受已取消或连接修订变化的结果。UI独审11项为8绿3红，三个反例同属一个P2：等待中打开对话框、布局设置或关联窗口后，旧回包漏掉原忙门。原红不删除，也不将五个反例算成五个独立产品缺陷。

窄修后作者原5红、新17项和旧5个迁移用例共27绿；类型首轮仅新增测试对unknown错误缺收窄，补测试类型后单项及最终类型通过。原71未重跑。Main在严格结算及外层IPC发布点复核来源、取消、连接修订和所见方案CAS，原失败保持；UI无副作用复核窗口/活动代次及dialog观察，不重弹丢稿确认、不reset新输入、不关闭用户窗口。

原审查者后台窄复核15绿（原两红、两个正常/文档对照及11个必要新对照）；UI窄复核13绿（原三红及10个必要对照），原其它绿例未重复。源码与原红夹具保持独立封存。Observer代码实际执行，但记录/投递由RAM端口提供，未证明浏览器原生MutationObserver或自然Electron IPC调度。

缩进作者14文件117绿、一次类型通过；其中20个新用例、97个回归。原基线新增七个显式格式化诉求为红、原44绿，不称为七个缺陷。真实React、锁定编辑器库及合成sql.js重启已覆盖，Monaco模型/布局仍为RAM端口。

交接SHA256：命名初版 `0f0819389ce39adf02f9d73d57bae34ab3af9beedb8c4fe53caf204672d7eb6c`；窄修 `f04f4bca05de353c4bb09c2d233c08135b8043b5fa1941592438cded80d85e8a`；后台原审 `0156bfbc0cf8e52c74999fffe47a69f2ef97814a9baca8e69b16401c52fe8bb9`、修后 `aa42e11a399db18df0048f48f347e68ee52008092f180e634019ec841bfa8f7c`；UI原审 `f09a78c4cd280b43743469082bce3d1004e8c546bd4cca8e9aef0dd770dd4075`、修后 `e288e30de87c8929a398b6297422eeb09d8287466813125ec1a6ce911268cbdc`；缩进 `8b7162eb1c7bfaf7dfce7b5fe3a82d6df689e5124d38fa4e861f21d546845ac4`。

## Root实际验证

| 来源与命令 | 实际结果 | 范围 |
| --- | --- | --- |
| `421ab95`：`vitest run`方案Main/storage/publication/UI、批量复制及草稿历史六文件 | 118通过，退出0 | 命名与批量TableTab共同存在的实际组件/函数接缝；没有GUI或数据库 |
| `f2bcde3`：`vitest run`缩进model/storage/UI、SQL格式化/UI、换行UI、方案storage/Main八文件 | 86通过，退出0 | 新旧偏好、schema7、显式格式化及方案命令接缝 |
| `f2bcde3`：`tsc --noEmit` | 退出0 | 完整整合类型 |
| `f2bcde3`：`node scripts/build.mjs` | 退出0 | 本普通clone独立dist，未改主目录产物 |

两轮有17项重叠且来源不同，不相加为204个唯一身份。私有证据位于Root ignored `parallel-integration/run1597-*`、`run1598-*`、`run1599-*`及`run1600-p0-merged-source-comparison.json`。日志SHA256：118项 `6595825162b79ab6fe502a34c87cf60e76abe1b54302df34aaa70a97574684d7`；86项 `fb86bd186d38ff9de9fe72fb182ac4fb7cbe945b134443543d8ede1cdccbdd1c`；类型空日志 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`；构建 `f125241918e1c34087501dc26ebb8aad0b8dc10d716dd575429976759b77f2c0`。

## 完整CI及旧夹具补齐

原固定 `863c70c833c99fc30c16c5f0d98a346a192a59af` 的[完整CI39075195842](https://github.com/zhao-yc/DBArk/actions/runs/39075195842)未通过：469文件中464通过、5失败；8817项通过、7失败、10条件跳过，另39个未处理拒绝。类型步骤通过，完整单元失败后未执行构建。七例报错为旧AST/VM提取夹具缺少新增的`invalidateTablePresetSources`、`tablePresetReads`、`reloadBlocked`、`bindEditorIndentation`依赖；39个未处理拒绝主要来自同一旧窗口夹具。正在补齐真实依赖，不能把缺依赖简单改成noop、吞错或删除原断言。原日志在Root ignored `run1601-863c70c-full-ci-original-red.log`，SHA256 `5518c7c2a04da33d2c76b132633fdb6fc1768caa90f985da18e9bcddf2b735ea`，原失败终态保留。

夹具修复：作者 `9f312e288e309a913200a6ab50835c6daa8d69c7` 对应Root `997d959d6f64033106f9ba5a47ea88d9b75cfe1a`，三个Main夹具使用真实来源类、实际失效/取消函数及登记Map；作者 `cba45f1bfa542ea5fbeb812c27668f7a1fa0f79c` 对应Root `48d9903aa108a79f9495af9786519aeb10c7f5d8`，两个UI夹具补真实忙门和缩进模型绑定器/事件端口。279处原断言（174+105）逐字与顺序保持，无生产代码、构建脚本、依赖或工作流改动。两个作者分别四文件37、两文件48通过，类型通过；交接SHA256分别为 `86cc763a44344593bcace3c153fe9a49a5f7d08b29f51e8784e5e8c6f8bd8a46`、`86b57b142145907af64eca4629812f4c449fef5636c262891c283111ff9fd883`。

Root固定48d9903合并后的六个受影响文件一次85通过，无未处理拒绝，类型退出0；日志 `run1602-fixture-integration/stdout.log` SHA256 `55143b182df75727470ea4f11aa4b07a645da043305b4a8ab4cd1c7c5c1e2819`。已逐路径核 `src/`、`scripts/`、package、锁文件和workflow与原类型/构建通过的f2bcde3完全相同，本次不重复本地构建；仍需新完整CI，不能把定向85代替全量终态。

随后固定 `0724e258abb5e677e06b3847cde8861591a9d74a` 的[新完整CI39075881038](https://github.com/zhao-yc/DBArk/actions/runs/39075881038)、job117522812255已成功：469文件、8824通过、10条件跳过，类型及构建均通过，没有原39个未处理拒绝。新日志 `run1603-0724e25-full-ci-green.log` SHA256 `058d8d96e04c2487c6fb7b5ebfafe66643f053e7a7599f2cd8f832f847869652`。这是真实新完整终态，原863c70c失败保持原结果，不按后来通过改写。

固定 `91e3c0ca6bfe188a299fdb28658d8d1dd93c036f` 的[三平台候选39076032988](https://github.com/zhao-yc/DBArk/actions/runs/39076032988)已启动。它仅比0724增加 `.github/checkpoints/v022-presets-indent-20261018.json` 构建标记，产品、测试、构建脚本、包/锁及workflow逐路径相同；GitHub API建分支后未出现该分支运行，普通clone提交标记并正常推送后已核到Windows及两种macOS任务。候选保持独立分支，不合并主分支或创建发行标签；当前尚未接纳三平台终态、安装字节或新功能原生实证。

## 未验收边界

本批已接纳上述0724完整源码检查；真实GUI、自然Electron IPC/原生Observer、服务器资源结算、安装及macOS私网组合仍待验。旧8244完整8763、0.21三平台源码/实装76及公开下载分别保留原来源，不外推本源码。本轮不运行SSH/Docker、读取数据库凭据、修改数据库或系统剪贴板；新批量及缩进正式E2E另在独立任务准备和窄修，默认关闭，尚未整合或实跑。

新随机 `dbark_phys_*` 零行实库控制器在创建进程前被自动审批拒绝，尚未启动或创建资源；既有授权问题待答，其它源码开发继续。未把新权限用户或新测试数据纳入本批验证。
