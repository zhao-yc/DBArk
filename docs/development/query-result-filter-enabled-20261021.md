# 已返回结果筛选条件启停

固定源码提交`12c08ad52a638bfced8101c71bfdb4cb84071765`已推送main，产品树`7ad1c2e8a71ff6de9fc4bba933584960174f96a7`；[完整CI39539815211](https://github.com/zhao-yc/DBArk/actions/runs/39539815211)的Linux job119024747003已success：Python21项、0.267秒，类型／592文件11398通过、10平台跳过／构建成功；单元134.98秒、Vite21.85秒。Windows及两种macOS架构原生job尚待终态；原生剪贴板job跳过。

## 实际行为

本地条件面板为每条条件增加“启用”复选框，默认启用。取消勾选保留字段、操作符、原值、区间、成员和大小写选项；编辑、复制、重开草稿及修改字段保留停用状态。仍须显式应用，不执行SQL或写入数据库；条件仅属于当前已返回快照，不持久化为跨重启预设。

停用条件不参与AND／OR，只有停用条件的子组整体省略；不能将其当作恒真项扩大OR结果。全部条件停用时保留完整条件树，但结果直接恢复原source和行顺序。应用仍清空原排序、勾选、查找与详情，复制和导出继续使用同一当前视图。

`enabled`缺省或true表示启用，false表示停用，其它类型和访问器拒绝。停用条件仍受32条、字段／操作符、成员结构、单值和总文本预算限制，但不解析数值／通配草稿，也不扫描或快照该列的原单元格；重新启用时完整重新校验，失败保持原视图。生效键漂移保护保持，停用键本身变化不撤销其它生效条件。

## 当前验证与原失败

开发机按远程连接不稳时的回退授权执行一次：

```sh
node scripts/check-local.mjs --build tests/unit/query-result-filter-enabled.test.ts tests/unit/query-result-filter.test.ts tests/unit/query-result-filter-groups.test.ts tests/unit/query-result-filter-case.test.ts tests/unit/query-result-filter-wildcard.test.ts tests/unit/query-result-sort.test.ts tests/unit/query-result-sort-nulls.test.ts tests/unit/query-result-sort-case.test.ts tests/unit/query-result-sort-ui.test.tsx
```

原生CLI进程71240于2026-10-21T03:32:36.8567060Z创建。类型26.69秒、9文件391项全部通过、Vitest11.73秒；首次构建被原Monaco补丁门拦住，整条CLI退出1、39.7273248秒，源输入前后未变。原stdout／stderr独立保留在`.cache/result-filter-enabled-main-20261021/`，摘要分别为ae1b8b60da1cf3372edefaff4ca9e35683faebc87e6eaf3f76201e15b692c896及f70b1a3a6deced0ac1b177fd3ef55237a46d6ea7160eccb6d56a5f96026bc92e。

核实际Monaco文件摘要为原上游507b02c2395b05aedcc3d512c6f7653bcf0e8205d4bc7af92398eafd61b31c89后，保留原文件，再执行`pnpm install --frozen-lockfile --prefer-offline`。pnpm12.11.2退出0，未下载新包；包配置、锁、workspace及补丁输入摘要不变，实际文件恢复为正式补丁b20417e61b8e71253ce6434e3568ec8c4d5d40ecdf945d419fda91d12a0e9420，没有放宽校验或改产品以绕过失败。

其后只重试`node scripts/build.mjs`：退出0、34.7652117秒、Vite33.93秒；保留Rollup注释和大分块警告。另运行Monaco补丁门及实际WordHighlighter取消的两个测试文件，23项全部通过、1.96秒。未重跑已通过的391项。新启停控制器覆盖组合省略、全部停用、坏草稿重启、独立冻结、原值读取隔离、漂移及预算；RAM组件覆盖复制、字段变更、取消、输入法、旧回调、原行与零额外SQL。

## 待验范围

后继在原`query-result-sort-case-live.ts`保留整例，仅追加实际启停复选框与重开草稿验证：停用副本、OR忽略停用叶、全部停用、仅重启副本、恢复AND交集，再沿原路径导出四行。所有ID期待独立手写，复用原虚拟网格读取、一次SQL／两次文件导出／历史不变及严格收尾，不改120秒、零重试、原复制和文件读回断言，不新建数据库用户。后继类型26.77秒、原默认关闭门／虚拟网格／大小写三个文件37项通过、Vitest0.864秒；这些是准备，不是本次真实窗口结果，也不属于12c的原CI范围。

以上是源码、内存组件与开发构建证据，不是原生GUI、实库、安装包或macOS的本能力验收。Q01的0a4实库窗口回合固定另一准确提交，不能计作本能力通过。后续完整CI及单项客户端验收另记，Navicat工作包仍部分，暂不发布。

整合版c449506已保留上述筛选启停产品及904组合用例，src树0eb5a6922e7ecc8ff75b0bdddc1c6e597d25c6d2；Q01独立0a4 GUI已通过，整合类型／七文件265项／构建也通过。筛选启停的新GUI和条件独立读回按[固定Windows操作单](../testing/query-result-filter-enabled-c449506-vm.md)执行，不能用Q01窗口结果替代。
