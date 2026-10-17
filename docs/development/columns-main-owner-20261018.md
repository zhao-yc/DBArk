# 字段能力的真实IPC归属与晚回包

本片基于 `6de216932f1f81e649b60ff62130a17924457ce1`，只改columns Main接线、私有helper及RAM回归，不改Engine/Tasks/UI或共享IPC。

真实IPC捕获当前窗口、webContents、mainFrame、进程/frameToken与主文档代次。Electron44主文档开始和提交导航均换代，崩溃/销毁撤销代次；同URL重载不能恢复旧能力。只有实际capture建立的私有context可进入columns dispatch，不提供默认有效回调。token归属保存在Main WeakMap，不出IPC。

get/preview在broker返回登记前及真实wrapper成功回复前各检查owner、可信投递修订、配置锁、退出状态、TTL与父snapshot对象身份。无法交付时先精确释放刚返回的能力再返回失败，清理失败明确可见。容量失败也回收新token；返回标识与既有记录冲突时不覆盖、不猜测释放另一编辑器能力。

release同步原子校验全部已知输入的用途、kind及owner，首个await前撤销父及关联未领取preview。退出和配置保存锁期间仍可精确释放，不建任务或历史。未知token允许按原columns协议幂等释放；它不证明远端任务或物理资源已经结束。

apply在首个await前消费Main预览；引擎一次性执行与资源结算保持。发送后不按只读晚回包规则倒写DDL OK或未知事实，不自动重放。

## 验证与旧夹具适配

- 新10组RAM测试通过AST提取真实IPC callback、dispatch、createWindow及validateMainCommand，使用实际私有helper，只替换Electron/store/broker物理边界。包含真实wrapper的第二等待边界，未手写另一份分发器。
- 原main-column测试断言保留；旧手工Map token改为先由真实capture/dispatch/get/preview建立私有归属，再调整测试过期时间。原测试的修订7→8现在先断言旧快照被拒，然后合法release并重新get，保留原“实际注入8”断言。只清fixture调用计数，不改变权限事实。
- 相关范围：原main-column、tableCreate、preparingTasks、connectionReplacement；后者使用临时LocalStore及驱动替身，不连接实际服务器。
- Windows默认TEMP下的connectionReplacement回归曾因SQLite文件rename EPERM失败；只将TEMP/TMP指向本项目ignored `.cache/columns-main-owner-implementation-20261018/temp` 后复验，不修改产品处理或测试断言。
- 初次含新harness的type检查发现模拟IPC事件缺少Electron44必需字段，已补完整事件形状；没有使用类型断言跳过owner。

相关测试实际命令（Node位于本机fnm安装中）：

```powershell
$env:TEMP = Join-Path (Get-Location) '.cache/columns-main-owner-implementation-20261018/temp'
$env:TMP = $env:TEMP
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/main-columns-owner.test.ts tests/unit/main-column-patches.test.ts tests/unit/main-table-create.test.ts tests/unit/main-connection-replacement.test.ts tests/unit/main-preparing-tasks.test.ts
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

## 尚未扩大的边界

原broker.request可能自动start worker。本片没有绕过私有成员猜测worker终态，也没有改broker通用协议，因此不承诺“退出清理绝不新起worker”；精确release错误可见。若要该保证，Root应另接有真实原worker/exit证据的窄投递接口，不以布尔或吞错替代。

无GUI、真实数据库、认证、网络或剪贴板验收。Main RAM成功不等于新collation执行或生产部署完成。员工只本地commit，Root统一整合并推送。
