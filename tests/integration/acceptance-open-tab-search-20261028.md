# 查找已打开标签验收（2026-10-28）

## 候选与执行边界

Root 基线 cfb3c6c2099e0edc69d8e60bc10e53273c28d381。源码包 open-tab-source01.zip：50633 字节／11 项（10 路径及 manifest），SHA256 `84e2959f0b399a65306f5539adfaf2572715543719ab19d0498dbd503f7e4b2b`。唯一旧 App 路径按 LF 基线核验，9 新路径须原不存在；备份后应用，旧 source49 仅 App 一个明确交集，其余 48 及其它 dirty 保留。不 fetch、切换或伪造虚拟机 HEAD。

WIN11-TEST 上一 routine-source01 五门均已终态 exit0，无测试／App 在途；source49／dist109 匹配，HEAD 仍 b523 detached，dirty101。本轮只做离线查找标签，不读认证、不连接数据库、不操作 Docker／剪贴板／安装或旧1392资源。本机仅开发、Git、源码传输和原件核对，不运行产品测试。

## 源码门

按序 typecheck、八文件定向 Vitest、build、专项默认关闭及 list，首错停链。保留每门原 PID、完整 stdout／stderr、退出码及候选／保留路径原字节，新 dist 单列。不把默认 skip 或 list 占位算作正式 GUI 验收。

源码01 typecheck 原 PID12060 exit0；八文件单元原15844 exit1，123通过／2失败。失败均在新 UI 测试：自动聚焦身份断言被内存 DOM 格式化器的 getAttributeNames 缺项遮蔽；target-aba 在92:83的“无新选择”断言失败。build／默认／list 均未启动，App与DB为0，旧dist109未变。

Root回读原件521008字节／117根项／128递归项，SHA256 `0c9c062a4aed6c0e103dcfdb989b5699d9333a54d34386eccb62a8b228bbea47`，CRC、逐项哈希、路径、私钥块与source58原字节通过。定位到产品的两处原因：Dialog layout聚焦被子Modal passive焦点覆盖；同轮目标A→B→A回到原tabs引用时，selector可跳过渲染，旧选择标记未撤销。修复只调整本Dialog的聚焦时序及标签变化渲染订阅；不修改通用Modal、原18项断言或拆开ABA的同轮操作。原失败保留，不归类为通过。

delta02只含一个产品文件，4140字节／2项，SHA256 `0a7ebb8eebb659d7ff62bf1e3bb8ccbcc8c40dc8a154ddf7c9b722d09249bac9`；其余57路径保持。typecheck10864 exit0，受影响两个文件12380 exit0／25项全部通过；另外六文件100项沿用源码01通过记录，不声称单次125项全绿。

源码02 后续原build14200 exit0；默认14712 exit0／恰1skip，list12796 exit0／恰1占位，五门全部通过。正式窗口单独执行，不包含在这五门通过结论中。

Root回读源码02原件532649字节／146根项／148递归项，SHA256 `5e810954329c727a289e382e07f4c4a9a7bca96da3f880f7cb11b375c1e3a4f7`，核CRC、逐项哈希、路径、私钥块、源码58及原stdout／退出码。五门结论成立，末尾正式失败不混入源码通过包。

## 正式离线流程

仅 `DBARK_OPEN_TAB_SEARCH_OFFLINE=1` 且 `DBARK_INTEGRATION_ENABLED=0` 显式启用单例；单 worker、120 秒、零重试、trace／screenshot／video 关闭，沿用原 owned 正常退出门。失败保留所属 App／目录，不强杀、不新起无归属窗口或重放未知状态。

正式 Main 准备两条无密码离线连接和24条注释查询，包含已保存查询绑定及 known-null／unknown／legacy。这属于测试准备，不冒称产品连接表单或新建查询验收。准备／reload 后冻结配置，只允许两个准确 activeTabId 各保存一次；数据库及 utility 请求拒绝。观察范围为当前 frame 旁观安装至正常退出前 restore，不扩展到启动准备全过程。

专项覆盖空态、组合搜索、同名跨连接准确切换、键盘选择及鼠标、Monaco 焦点快捷键、正文不参与搜索、无匹配 Enter／Esc 保持、原24标签／正文／绑定不变和实际条带滚动可见。Main settings.get 核本地落盘；未包含重启恢复。

正式01原Node CLI10672 exit1／1 failed／retry0。按顺序到spec120撤销旁观后的辅助步骤，restore已删除旁观对象，step仍在armed标记清零前后置读取audit，报undefined.check；原严格正常退出和最终成功附件未完成，不判通过。原Main9604／launcher14292后续均不在，profile ibYVwq仍保留；进程不在只证明不在途，不能补证正常退出。控制器未kill、退出或清理原profile。

失败原件60427字节／31项，SHA256 `f091545372c257fbb2906b64f220787e6bf9f6eabb1c4dab1efca802d4c2c91b`，Root核CRC／逐项哈希／路径／私钥块及原错误、归属记录通过。delta03只修spec在restore这一处跳过销毁后的audit；内部check／pending／permission／calls及所有业务断言、120秒与正常退出门不变。仅测试文件窄修，7556字节／2项，SHA256 `98254241f0752997b271687203736d288fb30ab99ed6e60ca3dc158b27a52f88`；产品与dist不变。确认原10672终态、无原归属或同userData残留进程后，才可开启独立新例；原失败和未知退出不追认为通过。

新独立轮 gate unit5956 exit0／13项，默认10556 exit0／恰1skip，list17708 exit0／恰1占位；正式Node CLI7992 exit0／唯一1case passed／retry0／原120000。launcher8468→Main9464，原24标签正文及保存查询绑定保持，两次准确activeId保存，旁观范围内DB／fork／pending均0，原严格正常退出通过。产品及dist未重建、未重复typecheck／25项；只对变化的spec及完整原生流程复验。旧失败profile保留，原未知退出不补判为正常。

Root完整回读新例525869字节／152根项／154递归项原件，SHA256 `72eba37f9d93cf0aab685899d4f2b3702d6a80e2f0e9d0a58fafb35d81f3b94c`。CRC、逐项哈希、路径、私钥块、原stdout／stderr与退出码、完整report和最终附件均匹配；source58与Root当前原字节一致，本次暂存10代码／测试文件也逐字一致。新profile53x4AD已不存在、所属PID观察为空，无控制器强杀或补做清理；旧ibYVwq未触碰。日志、profile及编译产物不入库，本轮只推源码，暂不发布。

表标签定位和身份边界由单元覆盖，真实表数据、活动事务、原生输入法、安装包及 macOS 未验；不以本轮证明完整工作台或完整 Navicat 功能，暂不发布。
