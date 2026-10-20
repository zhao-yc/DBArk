# 封存进程身份的离线比对

`scripts/testing/recordedProcessIdentity.ts` 只比较已保存的记录，不枚举、启动、终止或等待进程，不读写文件，不访问网络和当前系统时间。它不能代替真实进程观察、直接子进程追踪、资源释放或整轮验收。

`parseRecordedProcessTime` 接受整数纪元毫秒、`/Date(1792533601630)/` 和带明确时区的 ISO 时间。返回 UTC 纳秒区间及精度，均可直接存入 JSON；不把 CIM 毫秒与原七位小数时间的格式差异当成新身份。非法日期、无时区时间和失真的数字拒绝。

`compareRecordedProcessIdentity(original, observed, snapshotAt)` 的记录字段为 `pid`、`createdAt`，原记录另可含 `lastAbsentAt`。返回：

- `reused`：有明确晚于旧缺席的创建时间，或无缺席记录时有互不重叠的创建区间。
- `possibly-original`：创建区间重叠，保留原进程可能仍存在的判断。
- `unrelated`：PID 不同，仅说明该条不相关，不证明原进程缺席。
- `indeterminate`：缺失、无效、未来、矛盾或精度不足的记录；不得放行。

本工具不返回 `passed`，不修改原失败报告。调用方须保留原快照和字段缺失，检查同一原快照中其余已记 PID／直接子进程；只能另存补证，不能凭进程名称或新采样替换旧失败。对 `possibly-original` 和 `indeterminate` 均继续保留未确认状态。

本轮工具源自1f8阶段的真实反例：原17780在21:14:11 UTC已缺席，22:01:24快照里同数字对应创建于22:00:01的Edge。单纯数字缺席门仍保留失败，不重跑原189项或构建。工具尚未用于当前固定1f8队列，不改变其源码或验收门槛。

单元入口为 `tests/unit/recorded-process-identity.test.ts`；首次提交只静态审查及 `git diff --check`，Linux准确提交检查和Windows验证另记。本机不运行测试，暂不发布。
