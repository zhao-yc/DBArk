# SQLite 关联子记录独立表页（2026-11-04）

## 使用

从 SQLite 已保存父行打开“浏览 SQLite 子记录”，明确读取反向外键目录及子记录后，点击“在独立表页打开关联子记录”。连续关联浏览器在子方向读到完整子页时也提供该入口。新建的“子表 · 关联记录”标签显示固定关联和原类型父键；不会复用已有普通子表标签，也不会保存或放弃原父行、普通子表的草稿。

独立页沿用原表页筛选、排序、分页、末页、匹配行数、字段概况、候选值、导出和编辑流程。普通筛选的 AND／OR 只作用于固定关联之内，不能扩大为其他父行。可写物理表仍须先暂存本地草稿、预览 SQL，再明确确认提交；原只读连接及不可可靠编辑的表继续只读。新增记录按父键原类型预填可写子键，可核对修改，一次新增可一步撤销。显式修改外键或新增值可能使提交后的记录移出当前范围，数据库约束仍是最终裁决。

来源仅保留在当前进程内存。关闭原父标签不使已经移交的独立页失效；关闭独立页、修改其目标或连接配置则永久撤权。重新载入或重启后，保留的标签显示来源失效，不会自动读取无条件全表；关闭后须从准确父记录重新打开。失效时已有本地草稿保留供核对，不能继续提交。

## 实现与边界

- 共享严格合同记录双方结构指纹、真实外键序号、有序父子映射和 typed 父键。沿原 int64、NULL、TEXT、REAL 和有界 BLOB 合同；复合映射必须等长、不重复，关联及普通筛选共同受绑定参数预算约束。
- Main 在每次只读快照内重新核对双方目录及实际映射。固定范围使用 EXISTS，父列在比较左侧，子列加一元正号移除自身亲和性，保留父列 affinity／collation；非唯一父值不重复子行，含 NULL 的元组明确为空。整组普通 OR 筛选先加括号，再与关联 AND。
- 分页、末页计数、统计、候选值和完整流式导出保留同一范围。生成 SELECT 复用同一谓词编译器，不从已生成 SQL 中截取 WHERE。生成后是普通 SQL 草稿，用户可以修改并自行执行，不再受关联元数据守卫约束。
- 编辑快照在 Main 私有保存关联副本。预览仍为原有纯编译，不访问数据库；提交在 BEGIN IMMEDIATE 内重核目录，并在每条修改／删除前复核旧行仍属原关联及完整旧值。父键或子行被外部修改、删除时整批回滚，不自动重试。
- Renderer 通过保留的标签编号前缀识别关联页，父值不写入 settings、标题或 SQL 历史。缺失内存来源的标签不会进入普通表页；即便连接方言变化，也保留 SQLite 失效页面。新标签独立守卫及订阅不长期引用原组件或大草稿。
- 本轮限定表数据浏览和上述派生读取。导入、结构管理及整表维护仍以物理表为目标，沿原有明确确认流程，不能当作只处理当前关联范围。未实现常驻多分支关联树或完整 ER 建模，D05／R02 继续部分覆盖。

## 实际验证

实际平台 macOS arm64、Node.js 24.17.0及项目 Electron。WIN11-TEST只读检查不可达，未派发远端任务，按仓库约定回退本机。只使用独占合成 SQLite，不使用 Docker、SSH、业务库或系统剪贴板。

最终相关测试分三批互不重叠的15份文件，319项通过、0失败、0跳过；明细见 related-summary.json、related-final.json、related-missing.json与related-context-final.json，不累加前面重复轮次。覆盖正式 Main／真实 Node worker 的父列亲和性、OR范围、末页及计数、统计和候选值、结构漂移、提交时父值消失；正式 Renderer入口、独立标签去重隔离、来源冻结／ABA及原父键选择回归。新增完整导出实测从只有一行的源页输出同父两行，保留“001”与“1”，排除 OR 命中的另一父及 NULL 行；父结构漂移拒绝导出且不替换原目标文件。

最终完整单元：1288份文件全部通过，26792项通过、10项既有Windows平台tar条件跳过、0失败，退出0，459.94秒。以full-final.json独立统计，不与首轮计数相加。

严格类型检查通过；最终构建14.59秒通过，保留既有第三方PURE及大分块提示。默认 --list 只列出1项专项，不启动桌面或数据库。

新关联独立表页真实窗口专项3682毫秒通过，原固定120秒、1worker、0重试、trace／自动截图／视频关闭：

1. 只授权本例唯一可写合成文件及 parent／child 两张表。父1关联51行，包含TEXT“1”／“001”；另有父2控制行。原普通 child 与 parent 分别形成独立草稿，父 id 改为99但未写库。
2. 从准确已保存父键 INTEGER 1打开独立子表页，Main返回51行。普通子表未被复用，固定范围不受父草稿99影响。
3. 独立子页修改一行，预览取消后磁盘保持；再次预览并明确确认，唯一一次 apply 成功，控制行及父表保持。
4. 新增表单预填 INTEGER 1；取消后一步撤销，磁盘仍52条子行。核对原普通子表草稿和父 id99／备注草稿仍在，验后明确撤销清理。
5. 同一准确窗口重新载入后显示关联来源失效，tablePage读取次数不增加，settings不含关联映射或父值，零越界／页面错误。
6. 所属Electron退出0，原fixture删除独占目录，另核文件系统确实不存在。已直接检查固定关联说明、父键原类型、独立标签及网格PNG。

既有 relationships完整窗口整例11990毫秒通过，保留原关系图两主题、父候选与明确提交、反向分页、四层连续浏览、返回／前进零读取、换分支及父hash续读断言。所属窗口正常退出0、准确目录删除已核。两个专项串行执行，未同时占用桌面。

## 失败记录与未验范围

完整单元首轮26751项通过、10项既有条件跳过、38项失败；失败集中在两份抽取正式函数执行的VM夹具遗漏related变量，补齐普通页上下文并增加失效保留草稿断言后，相关41项通过，再执行完整回归。早期单元夹具曾缺 Main 私有 apply 能力、误带 strict schema 不接受的 target.kind，以及取错 settings.save 轮次；均修正测试夹具，原门槛保持。原生首轮在新增表单使用了“编辑当前行”标题，第二轮在重载后漏列 workbench.protocolReady 握手；两轮分别停止，完整报告、PNG、合成失败数据库及所属进程记录保留。各自准确PID均已确认不存在后才手动复验；没有放宽超时、断言或自动重试，失败目录未强删。

Windows本增量、Mac Intel、安装包、实体输入法与人工辅助技术未验。UI原生专项没有逐项点击统计、OR筛选及完整导出；这些由真实Main／worker及正式Renderer意图测试覆盖，不能泛化为逐项原生验收。文件chooser只定向本例合成库，未验OS对话框键鼠。暂不正式发布，完整Navicat目标尚未完成。

## 命令与交付

项目 Node24.17.0置于PATH首位。实际命令：node scripts/check-node-runtime.mjs；DBARK_INTEGRATION_ENABLED=0 node node_modules/vitest/vitest.mjs run --maxWorkers=1 --reporter=json（相关测试指定文件，完整单元不筛选）；NODE_OPTIONS=--max-old-space-size=2048 node scripts/typecheck.mjs；同2GiB堆 node scripts/build.mjs；node scripts/sqlite-workspace-ci.mjs related-tables；node scripts/sqlite-workspace-ci.mjs relationships；node node_modules/@playwright/test/cli.js test tests/e2e/sqlite-related-table-native.spec.ts --list；git diff --check。

原始结果位于.cache/sqlite-related-table-20261104/及test-results/sqlite-related-tables/、test-results/sqlite-relationships/。本轮没有持续服务，无需停止命令。项目归档.local/交付/2026-11-04-SQLite关联独立表页-v1/；自动备份/Users/zhaoyuchen/同步空间/codex重要文件备份/tabrelio/交付文件/2026-11-04-SQLite关联独立表页-v1/。

保留可编辑Markdown、源码／patch、各轮日志与JSON、完整原生报告／回包、PNG、两轮失败合成数据库及交付ZIP。原件到归档、归档到备份逐文件SHA-256核对，ZIP另核CRC；独立新版本保留历史。未生成PDF、正式安装包或发行，源码推送不代表发布。
