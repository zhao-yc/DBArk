# Windows源码：多列排序、文本与精确区间筛选验收

## 固定范围

WIN11-TEST的“dbark测试”会话验证固定产品 `3a85b5897de928f4baed6c51aec82007545f8f7c`，源码树 `02cb3ac4d75f114ec7d09dd9ca7b7a3ad9e429ab`。后继a980343仅更新文档，产品、测试、依赖、脚本和构建配置差异为空。本批按main流程交付源码，暂不发行；后续多值列表候选不计入此范围。

原生入口为 `tests/e2e/query-result-organize.spec.ts`。原观察连接校验200／13384的MySQL 8.4.11、Linux及UUID `f568f70e-c730-11f1-8190-3e6c830dde01`；保持原120秒、零重试、固定常量查询、审计及严格退出门。业务查询和导出不创建测试数据库或表，凭据仅给本轮子进程内存。

## 实际结果

| 层级 | 本次事实 | 范围 |
| --- | --- | --- |
| 类型、定向、新构建 | 退出0，入口93.633秒；类型36.35、单元阶段9.42、构建47.75秒 | 7文件289项全部通过、无跳过；109个新构建文件，不复用721旧构建 |
| Electron实库界面 | 单次退出0、外部16.72秒；报告15.894522秒，用例正文14.408秒 | 1个复合用例通过、0跳过／重试；七文本条件、BIGINT／DECIMAL区间、颠倒端点拒绝与修正、多列优先级、空结果及同一可见行列导出 |
| 独立文件读回 | VM报告Python标准库读回通过 | CSV／JSON行1和3、列序、精确整数／小数、NULL／空串／BLOB一致，不调用产品解码器生成期待 |
| 完整Windows单元 | 退出0、350.49秒 | 576文件、11021通过、1原有POSIX平台条件跳过、0失败；自然退出，未重跑 |
| Linux独立CI | [39380478951首次运行](https://github.com/zhao-yc/DBArk/actions/runs/39380478951)成功 | 类型／576文件／11012通过／10原win32模拟流程跳过／构建成功，桌面与发布job跳过 |

指定入口与完整单元命令见VM原报告；原生实际命令为：

```sh
node node_modules/@playwright/test/cli.js test tests/e2e/query-result-organize.spec.ts --workers=1 --retries=0 --reporter=json --trace=off
node node_modules/vitest/vitest.mjs run --maxWorkers=2 --reporter=json
```

原用例断言一次业务查询、两次导出任务准确完成、审计pending／revision为0、历史未被导出重写、原owner正常退出及observer同一stream关闭。最终Git干净、所属进程为0、109份构建哈希不变。任务ID及owner nonce没有单独序列化，不从输出目录随机标识推断owner。

## 原件及限制

原件仅在VM `outputs\query-context-successor-3a85b58-vm-20261020`。开发会话已读回报告、原清单摘要及完成结果，未独立下载复算：

| 原件 | 原VM清单SHA256 |
| --- | --- |
| successor-result.json | a75783b5c8f7ba46a084ae59948ca27e878e2d7fbf8d24f9d0bd753567ad4a34 |
| successor-native/native-original.json | 35bd240dd6e87368ec4a308c9fd149ff6fb17651e1af722316f64b02048d2929 |
| independent-readback.json | 6ad90cc39ad21e9649b2d355f644b3553b1c4483b4d266946873f50151855597 |
| full-unit-original.json | ee4a404d12f5ef359b39a3edb5ec434a5b190736abe61edf6345f7c7943e41d3 |

原5b1与977两轮失败、45秒worker收尾超时和保留目录继续留存；本轮不追认旧轮通过，也不单凭一次成功宣称所有偶发超时同源。文件选择框回答仍为本例准确替代答案，复制为合成ClipboardEvent；不算系统文件框、系统剪贴板或系统输入验收。没有日期时间区间GUI、其它数据库版本、安装包、macOS或本机Navicat二进制验证，不增加完整工作包及公开发行计数。
