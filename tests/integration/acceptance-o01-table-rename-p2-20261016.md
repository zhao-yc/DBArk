# 表重命名4b00d80两项P2修复

本补丁直接基于`4b00d80c949a825ad1c0f5b4a040dfc560ec7ce4`，分支`codex/employee1-table-rename-p2-20261016`。原提交与员工3原报告、失败探针均保留。本补丁不含AUTO_INCREMENT功能、不修改Sidebar/CSS、不自动合并ROOT或其他克隆。

## 权限阶段分离

| 阶段 | 保持的证明 |
| --- | --- |
| get | 全局SELECT/SHOW VIEW/TRIGGER可见性＋来源ALTER/DROP；未知新名不等于来源，不要求来源CREATE/INSERT |
| preview | 同样的完整目录可见性＋来源ALTER/DROP＋明确目标CREATE/INSERT；纯读取，不发送DDL |
| apply | 发送前再次执行同一完整权限及来源定义/模式/原生ID/依赖/目标冲突检查；权限撤销仍消费令牌并拒绝DDL |
| 后核验 | 保留完整目录可见性和真实物理身份、模式、完整定义、旧名消失等检查；不追加新表ALTER/DROP或任何写授权 |

角色、部分撤销、引用星号、未知授权和缺失目录可见性仍拒绝。PROCESS权限仍由实际原生目录查询校验，不把空目录当完整无依赖。外键/触发器/视图/CHECK、版本/平台和ASCII身份范围未放宽。[MySQL官方权限要求](https://dev.mysql.com/doc/refman/8.4/en/rename-table.html)是来源ALTER/DROP、目标CREATE/INSERT，表级授权不会随改名迁移。

## 名称往返与物理身份

引擎后核验返回`after.physicalIdentity`：由服务器身份摘要与原生TABLE_ID组成的SHA256凭证，不使用名称或DDL摘要替代。App只在definitionVerified=true、连接版本仍有效且凭证存在时，调用`completeTableRename(before, after, physicalIdentity)`。

导航记录保留整个当前窗口内已知的“精确名称→物理身份”历史：

- 同一已核验物理表a→b→a可以重新认可a，新迁移收藏和重新生成URI能够导航；b继续退役，旧代次不恢复。
- 名称曾对应另一物理表，或第一次退役时身份未知，继续停用名称链接。即使后来又回到最早身份，也不抹除已知歧义。
- 不全量清空记录，不按名称解除退役；连接/数据库精确隔离。完成回执、退役、卸载等均撤销旧导航代次。
- 当前v1 URI只携带名称，无法区分同一名称的不同物理身份。存在已知歧义时，新生成的同名v1 URI也保持拒绝并明确提示从真实对象树核对；没有为了方便新链接而恢复可能指向其他物理表的旧URI。跨重启/未观测外部替换的身份链接升级仍未交付，保留原切片边界。
- 未完整核验、未知执行结果、无效凭证和跨库/连接回执不得重新认可目标。DDL已完成事实仍保留，不重试旧令牌。

## 原探针与严格正反验证

员工3原件只读来源：`.cache/parallel-20261015/d06-find-replace/.cache/review-table-rename-4b00d80/`。员工1逐字副本及SHA256在本克隆`.cache/table-rename-p2/original/`与`provenance.json`。没有改写员工3报告或探针。

1. 用本克隆Git对象重新归档固定4b的src，运行原8探针（仅调整导入位置与缓存输出路径），独立复现5通过、3失败。原失败报告为`.cache/table-rename-p2/baseline-results.json`，不是引用口头结论。
2. 权限4原探针保持原断言，指向修复源码后全部通过。导航4原探针保留原期待；仅将往返正例的两次完成调用按实际App新契约携带固定模拟物理凭证，其他3项负向/隔离/迟到对照保持。合计8通过，结果在`.cache/table-rename-p2/independent-results.json`。这仍是驱动/IPC边界探针，不是实库URI或GUI通过。
3. 正式单元补入6项Engine权限阶段正反对照、2项授权/凭证边界、3项实际收藏/URI往返与不同身份复用/未知/迟到测试；专属5文件由56项增至67项。强制缺失目标写授权零DDL、执行前撤销权限消费令牌、执行后丢失读取权限不完整核验，均未放松。

相关回归14文件168项全部通过；布局持久化组的TEMP/TMP限定员工1克隆缓存，不访问业务服务器。类型检查与构建按本分支最终源码执行，结果和日志随交付回执保留。

实际纯命令：

```powershell
node node_modules/vitest/vitest.mjs run --config .cache/table-rename-p2/baseline.vitest.config.mts --reporter=json --outputFile=.cache/table-rename-p2/baseline-results.json
node node_modules/vitest/vitest.mjs run --config .cache/table-rename-p2/probe.vitest.config.mts --reporter=json --outputFile=.cache/table-rename-p2/independent-results.json
node node_modules/vitest/vitest.mjs run tests/unit/engine-table-rename.test.ts tests/unit/main-table-rename.test.ts tests/unit/table-rename.test.ts tests/unit/table-rename-tree-refresh.test.ts tests/unit/ui-workbench-navigation.test.ts
node node_modules/typescript/bin/tsc --noEmit
node scripts/build.mjs
```

本轮只做纯验证，实际六实例核心、正式Electron、安装验收和资源清理由ROOT在固定集成提交继续执行。没有GUI、200、剪贴板、Docker或worktree操作。自增在研实现另保留在`codex/employee1-auto-increment-20261016`的本地检查点`4fa6155`，未推送、未混入本补丁。
