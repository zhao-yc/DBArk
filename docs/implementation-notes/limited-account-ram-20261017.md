# 两条临时限权账号的密码仅驻留会话内存

Root 后续检查点：整合 `649b317` 的 19 项定向、类型及入口列表通过；生产和 108 个构建文件与完整 6546 项已验 `39e8701` 逐摘要相同，没有重复计算旧回归。Windows/13384 的两个真实权限界面身份均单次通过，前后六实例资源零，见[源码实证及边界](../../tests/integration/acceptance-limited-account-ram-root-20261017.md)。不计入固定 R93 安装并集。

本片基于已推送的 `df086381e837f9eaaab7d646773b106ceb23b89e`，只供后续源码及候选集成。固定R93矩阵与其两个旧身份的状态不变，不能用本次纯回归或列表结果将它们记作安装验收通过。

## 改动范围

`tests/e2e/data-search.spec.ts` 的“真实列权限：不可读键仅降为只读命中，明确搜索不可读字段仍报错并可恢复”和 `tests/e2e/references.spec.ts` 的“父表权限不足时读取明确失败，可空复合外键仍可清空草稿并经预览提交”，各自在临时账号的真实新建连接表单中取消“安全保存密码”（`zh.connections.text016`），断言未勾选后才测试、保存连接。不是通过引擎桥接替换认证参数。

仅临时限权账号密码适用本变更。产品新建连接默认仍为 `rememberPassword: true`，共享 `isolatedDatabase` 的管理账号连接和其它用例保持原策略。本片没有修改权限、账号生成、对象、端口、TLS、追踪、清理或超时参数，也不提供执行授权、认证输入工厂或安装队列。

## 原预算与来源

来源是固定R93头 `93f33ecab4090a5284a7988bc52d7744f8d99118` 的原矩阵及关闭队列，而非本片生成的新身份：

| 原身份 | 原项目及绑定 | 原预算 |
|---|---|---|
| B043 / W043，数据搜索列权限 | `installed_product_cp_13384`，200服务器13384明文 | 本例120000毫秒；原5项混批600000毫秒；外围900000毫秒 |
| B076 / W076，外键父表拒读 | `installed_d05_permission_13384_only`，200服务器13384明文 | 本例及整批180000毫秒；外围900000毫秒 |

两者原 `workers=1 / retries=0 / repeat=1`，`nativeClipboardActions=false`。B043混批中的其它四项不因本修复获得执行许可。C02的mTLS/SSH身份仍排除，本片不读取它们的fixture、证书或密钥。

原件相对主检出目录 `D:\svn\DBArk`：

- `.cache/parallel-20261015/w01-offline-window-regression-20261017/.cache/candidate-93f-windows-static-20261017/windows-static-matrix.json`，SHA256 `1308b2a921d8f35b1e80affd4f22fee46f63521c1270bf683561236dd8eb0c6d`。
- 同目录 `queue.preparation.closed.json`；静态来源摘录保存在 `.cache/parallel-20261015/employee4-table-create-mysql57-20261017/.cache/r93-limited-authorization-static-20261017/closed-plan.json`、`source-evidence.json`。

这些原件只是来源指针，不是仓库测试的依赖，也未被本次修改。

## 验证方法与边界

`tests/unit/limited-account-ram-fixtures.test.tsx` 用TypeScript语法树定位上述两个准确标题，提取各自新建连接至保存关闭的连续原始语句，不导入实库fixture或执行其DDL、权限和清理流程。语句驱动真实 `ConnectionDialog` 的ReactDOM输入、复选框、测试按钮、表单提交，以及真实 `saveConnectionUpdate`。内存定位适配不替换 `rememberPassword` 或待提交配置；内存DOM补投浏览器默认的表单提交事件，不代表原生输入、布局或焦点验收。

外部调用仅接入声明过的RAM端口。主进程存储部分从生产 `storage.ts` 提取实际 `saveConnection / putSecret / readSecret / hasSecret / connections` 方法，在Map端口中执行；不加载SQLite、Electron、磁盘存储或系统加密器。断言测试与保存请求都携带 `rememberPassword: false`，临时密码只进 `volatileSecrets`，连接JSON没有明文密码，持久秘密槽为空，保护器可用性、加密及解密调用均为零。普通新连接对照组仍默认勾选并调用合成保护器，确认本片未改变普通账号策略。

父版保留原fixture时，两条临时账号回归因 `rememberPassword: true` 失败，对照组通过；仅加入两处表单动作后转绿。定向新回归3项及既有连接变更保护16项共19项通过，`tsc --noEmit` 通过。真正Playwright `--list` 在仅含关闭标志和专属临时目录的隔离环境执行，准确列出两项、各自执行记录为空、退出码0；没有继承认证环境。

本轮未执行真实GUI、safeStorage、数据库、SSH、剪贴板、CI、安装或Docker，也未读取私有环境文件、证书、密钥或旧私料工厂。纯测试worker和列表进程有网络、子进程、私有文件与密钥生成拒绝守卫。实际验收及后续候选由Root统一负责；本片不晋升R93身份或覆盖统计。
