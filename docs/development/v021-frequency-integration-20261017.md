# 高频功能源码整合检查点

2026-10-17，普通克隆任务分支`codex/v021-frequency-integration-20261017`，基线`3f623fec4fe84f5d82580e51009e57840f03aafe`。没有工作树，未修改ROOT冻结的0.20候选和108个构建文件，本次也未生成新产品安装包。

本片整合已独立审阅的时间列自动更新及选区格式化：

| 来源提交 | 能力 |
| --- | --- |
| d3b8ce93bf9fbfa05fa1fbcb22eeb129bc07453c | 普通DATETIME/TIMESTAMP既有列的受控ON UPDATE |
| 474324a2792381e613045a608e47b8fe74e55aed | 既有列正式验收定义 |
| e724d61f03f62f19e0258a3fc7b0a63fb5f80337 | 新增列显式ON UPDATE与DEFAULT/精度守卫 |
| 4c1a12ea6cc1819af06236b903c0e68bc3d957cb | 新增列正式验收定义 |
| be28a4f29ee67de1304b8fc62a42fddf5a9788d6 | 选区或全文格式化、语义保守校验和单次编辑撤销边界 |

ROOT在合并后的实际暂存树执行7个相关单元文件，共148项通过、0失败、0跳过；随后`tsc --noEmit`及暂存差异检查通过。执行时HEAD仍为上述基线，验证的是本片整合暂存树，未把来源分支的独立结果冒充整合验证。对应本地JSON保存在忽略目录`.cache/integration/frequency-unit.json`。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/engine-column-patches.test.ts tests/unit/main-column-patches.test.ts tests/unit/table-column-add-on-update.test.ts tests/unit/table-column-on-update.test.ts tests/unit/ui-column-on-update.test.tsx tests/unit/sql-formatting.test.ts tests/unit/ui-query-formatting.test.tsx --maxWorkers=1 --minWorkers=1 --reporter=json --outputFile=.cache/integration/frequency-unit.json
node node_modules/typescript/bin/tsc --noEmit
```

既有和新增ON UPDATE的能力与版本限制、混合属性拒绝及原ADD路径保持详见各自说明；格式化只在token、选区和模型世代均可证明时编辑。真实Monaco Undo/Redo、隔离数据库往返、跨平台和新发行包均尚未验收。同期正文订阅就绪缺口与单表TRUNCATE仍在独立切片处理，本片不将它们视为已经修复或合入。

## 随后整合：单表清空

从上述整合提交`3288b0d4491c8635652f500e98cc7cd7c31d4735`继续加入单表清空实现`04756f0cabd91e01a26010e4a2979dc8b4aa6251`、正式定义`540c4b6035059fb6afd78ab38fb889656dbe4655`及列表门修复`76cf6e191018e76877b5041f893bde126888dba8`。独立窄审的四项组合反例无核心阻断；发现的双门开启时list未短路已修正，旧版8项反例失败，修复后12项通过，原live定义和期限保持。

ROOT在整合后暂存树另执行六个清空相关单元文件，71项通过、0失败、0跳过，随后类型和差异检查通过；本地报告`.cache/integration/truncate-unit.json`。未重跑员工521项大套，没有执行真实清空、GUI、安装或产品构建。准确确认、未提交草稿阻断、单次token与未知不重放的源码已进入本分支，真实数据库和新候选验收仍待ROOT安排。正文桥接仍为另一独立切片，没有用旧0.20候选证明这些新功能。

## 完整整合验证

随后ROOT对固定`968628d22ea55faed705710e440ce859f4a22996`提交（树`c859fe9018f4c63b80f0fd980e79d28caea3499f`）执行一次完整单元、类型和源码构建：5255项单元全部通过，类型和构建退出0，1286个跟踪输入及Git树前后保持。结果在本副本忽略目录`.cache/integration/full-source/summary.json`，构建只写本副本dist，没有改ROOT的候选产物。

上述事实比前面的定向检查更新，但仍是固定源码的验证，不是数据库、原生窗口或安装包证据。内部版本未改、未公开发行，也未包含另一分支的正文桥接；真实ON UPDATE、清空表及格式化Undo/Redo界面继续按独立计划验收。

## 随后整合：正文桥接、快捷格式化与退出归属

本次产品提交`f9dfa3c4f877b6b58f218d3d8c1b69b451014f71`整合两次正文桥接修复、Alt/Option+Shift+F、严格退出归属和索引验收收集门。ROOT最终5335项完整单元、类型和构建通过，1298个跟踪输入及执行树保持，提交树精确等于执行树。此前3项CALL RAM端口失败保留，只补齐默认退出模式端口，未放宽原异常、截图及清理断言；详见[本批源码实证](../../tests/integration/acceptance-frequency-source-20261017.md)。

这是对上面历史检查点的追加。内部版本和发行状态保持；实际界面、六组合、安装包及其它独立新功能不由此次源码结果接纳。
