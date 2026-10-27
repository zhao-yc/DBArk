# 例程调用草稿验收（2026-10-28）

## 候选与范围

基线`f2857901643a552cbf28ba747b10981ebef2962f`，新增独立可取消例程参数目录、CREATE头校验、IN／OUT／INOUT和函数调用草稿、侧栏入口及重新核验。仅生成新查询草稿，实际参数和值由原查询执行链处理，暂不发布。

22路径候选`routine-source01.zip`为177623字节／23项，SHA256 `6f3d049642f9e020751fd5d44a759c7357ba9d32746ff785398a6a78a453a261`。Root统一LF后冻结；WIN11-TEST核7旧路径LF基线和15新路径不存在，备份后精确应用。旧source32有main/index、App、commands、contracts、validation五个明确交集随本包更新，其余27原字节不变；旧dist109备份，HEAD仍b523 detached，其他原dirty未改。

## 源码门

按序运行完整typecheck、八文件相关Vitest、build、专项默认关闭及list；首错停链，不自行修改产品或断言。具体原PID、退出码和失败／通过结果后续追加。本机只开发、Git和原件核对，不运行产品测试。

原17036 typecheck exit0；原16720八文件170项全部通过；原4292 build含完整类型exit0，新dist实际109文件。关闭门11300 exit0／恰1skip，list17784 exit0／恰1占位，独立环境DBARK键为空；App／DB／新资源均0，认证文件未读取。

首门启动前控制器误把`prior-source32-preserved.json`替换成不存在的`prior-source49-preserved.json`，尚无产品门native-start。原脚本、错误与单点路径修正回执独立保留，修正后首次启动上述五门；源码应用、产品、断言和门槛未重做或修改，不算产品测试失败。

Root完整回读647105字节／117根项／140递归项原件，SHA256 `b439e95a0fe3a39f9d026e6d57cf51e2490aaf5031c43dfaa2da7582603cea47`，核CRC、逐项哈希、路径、私钥块及原stdout／退出码。22候选与Root逐字一致，完整source49也与Root当前原字节一致；各门49路径不漂移。原件／日志／构建留忽略目录，不进入公开仓库。

后续交付头 cfb3c6c2099e0edc69d8e60bc10e53273c28d381 的[CI 40596329800](https://github.com/zhao-yc/DBArk/actions/runs/40596329800)已终态success。Linux原日志为897文件／19077通过／10跳过，类型与构建通过；Windows x64、macOS arm64／x64任务均success，原生剪贴板专项和发布任务skipped。此CI不替代本功能尚未执行的真实例程调用、隔离资源清理或安装验收，仍暂不发布。

## 实库授权及预期证据

新资源预置指令被自动审批审查拒绝：既有授权被认定仅覆盖cp／列权限和外键隔离资源，未覆盖新`dbark_e2e_call_*`库。指令未送达测试会话，未执行DDL或调用；Root已发精确异步授权问题，回答前不连接测试数据库或绕用旧库。

拟验一个随机专用库的audit空表与echo_mixed、exact_add、ping0、out_only四例程，无用户／授权／全局配置变化。正式窗口在预览及填参阶段零调用，四种脚本各明确执行一次，核两结果、OUT／INOUT、UINT64、DECIMAL、微秒、NULL与字节；audit仅一行。源查询基线只含未执行SQL，不冒称已有结果或活动事务保持实证。

预置／正式调用／精确清理均另派，只有实际原件才能记为通过。默认及list只证明关闭门；安装、macOS、真实取消与异常调用恢复、其它数据库版本和完整可视化例程执行继续，不借源码测试替代。
