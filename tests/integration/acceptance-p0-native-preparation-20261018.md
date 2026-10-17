# 高频专用原生验收准备与首轮实际尝试

日期：2026-10-18。Root固定 `25da8e49477feb2c4f7251e77343d0e6519ea7b6`，版本0.22.0；产品、脚本、包、锁及CI与已构建的f2bcde3相同，本批新增测试准备。原生门默认关闭，没有把测试准备计作功能验收。

## 批量草稿GUI准备

作者224489c对应Root7e5f0b8，准备三条真实GUI用例，但实库资源未分配、用例未实际运行。独审先以10项RAM复现两个P2：迟到目录返回仍继续启动、收尾未核原期限。作者6d07abc对应Root11ae98c，以显式可选hook核原TestInfo、原120秒及永久保留状态；旧无hook路径保持。

原审13项窄复核12绿1红：旧native launch迟到仍会覆盖下一owner的共享desktop。作者 `2a957c57c64a9cfffbdac33e30cad9e356b5c732` 对应Root19eea76，新准备路径先在原state登记原app/主PID，以私有app/page完成初始化，全部授权及共享句柄核对完成后才同步发布；迟到事件不写下一owner。

独立8项窄复核全部通过：原B5、合法发布、迟到launch保留app/PID、迟到firstWindow、close/console/pageerror各自隔离、无hook兼容。没有重跑A3/A5或其它旧绿；报告SHA256 `6e17333f691395f81bdebe1590df81b99f074e39f6ec163e9cf42aa37007ccb1`。这些是实际原函数加RAM端口，没有真实桌面或PID消失证明。

## 缩进GUI准备

作者cb8b80c对应Root495eaf1；作者 `1940e66f29d276b33c6cf23b44ab51c4a58869cf` 对应Root25da8e4。补原TestInfo/_startWallTime/120000毫秒期限、afterEach永久停链、runtime内部每个await的完整授权、迟到资源先登记，以及Root预先固定入口路径/编译资源清单和SHA256。新/重启模型显式核detectIndentation=false，8列Tab热更前后真实键盘Undo/Redo及非空选区均有断言。

独审后端21个不同RAM用例通过，原三项P2的六红对应边界通过，旧原44未重跑；交接SHA256 `65003457eb6695e87f1a01e9565129ac396f80bf1491f0c56c6a151bde4a9ac6`。原UI审查者4个RAM窄反证也通过，交接SHA256 `8c5e94b6ba4fee233eea603375a2fd558150f42387f504cbcd5b37ae182c40c3`。均不能代替真实Monaco操作。

## Root整合检查及实际原红

Root七个相关文件122项一次通过，类型检查退出0。没有加载项目.env或实库参数；日志 `run1613-prepared-ui-integration/stdout.log` SHA256 `018365af516f7947f96ed3846828ec425b0a527f81993c6f4683ec445ae256d9`。为正式原生专项重新固定编译树，调用现有buildMain/Vite/copyCompletionLicenses并关闭envDir，构建退出0；日志 `run1615-indent-source-build/build.log` SHA256 `b67c74bc6fc5d2c6f563e3af42067a37ecefdb11c3e56bf4d97dec822e31b311`。

有一份清单在构建终态前提前生成，仅含11个文件，尚未用于启动，原件保留且作废。修正准备器后强制接纳固定头的成功构建状态及main/renderer入口，再生成112文件清单；获准实际运行的是 `run1614b-indent-source-identity/manifest.json`，SHA256 `dcd02eac175facbae449972f68e1b809e4be58d98dd835efc812f9bfc77ba4ad`。

`run1616`只执行了一次正式Windows源码离线缩进用例：0通过、1失败、0重试，约4.5秒，尚未进入缩进业务UI。首次native launch后、firstWindow准备前，runtime的实际主进程/metrics PID守卫拒绝；原异常没有逐项记录actual/expected，不能据此判断是PID错配、空metrics或暂态无效值，更不能宣称产品缩进缺陷。作者继续静态定位及补足必要诊断。原JSON SHA256 `051b7c4e7526581d458a683f45e92721b54d6eb2c734cbc868b50a26a7c37499`，stderr为空。

原附件记录本例临时目录及一个已取得的主PID，未确认will-quit/close/正常退出，目录保留；随后观察未发现DBArk/Electron进程，不能以此补写正常退出成功。本控制器没有强停、自动重试或删除目录。未读取数据库凭据、连接200、执行SQL或使用系统剪贴板。新GUI增量未纳入91e3三平台统计；仍需修正后真实源码/安装及macOS专用验收。
