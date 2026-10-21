# 暂存整理：Windows 源码实库验收

## 固定版本与环境

- 仓库 `D:\svn\DBArk`，分支 `main`；实际测试提交 `6e365406295fe44e63790e66607ee6e4e0e8dcca`，`src` 树 `42857d107847fcfa7f43811094aa5ebb2b0c0a8a`。普通目录，无工作树。
- WIN11-TEST 已连通；新标准 Git 克隆在创建进程前被自动审批审查拒绝，只返回 `blocked by policy`，没有 PID／退出码。虚拟机上的新安装、构建、GUI、实库均未启动。按用户允许的本机回退执行；原 VM 699／62／c54 现场未动，没有改变 Git TLS 后端或全局配置。
- 实际平台为本机 Windows 源码 Electron；沿已有私有配置在内存取认证，先核对 200 的 13384 实例 UUID、Linux／MySQL 身份，再执行原常量 SELECT。没有创建数据库、修改服务端资源、执行 Docker 或使用系统剪贴板。

## 检查与首次失败

`pnpm typecheck` 成功；`pnpm build` 成功，Vite 46.34 秒，保留依赖注释和大块提示。最终六文件 357 项全部通过：

```sh
pnpm exec vitest run tests/unit/query-result-memory.test.ts tests/unit/query-result-history.test.ts tests/unit/query-result-sort-ui.test.tsx tests/unit/query-result-sort.test.ts tests/unit/query-result-filter.test.ts tests/unit/ui-explain-plan-state.test.tsx
```

首次四文件为 185 通过／1 失败：排序视图的额外属性可随规则进入暂存。改为显式投影允许字段后原四文件 186 项通过；补 SQL 失败／无列结果的主动丢弃后，上述六文件 357 项通过。没有降低断言或替换正式控制器。

## 正式窗口与独立读回

原生 CLI 为 `node node_modules/@playwright/test/cli.js test tests/e2e/query-result-sort-case.spec.ts --reporter=json --output=本轮独占目录`；认证仅在子进程环境，不在命令参数。默认 `--list` 仅登记关闭占位，未计入通过。

原 GUI CLI PID **17580**，创建 UTC `2026-10-21T19:09:03.6399157Z`，退出 UTC `19:09:34.5057118Z`，退出码 **0**，30.8892318 秒。原报告 **1 通过／0 跳过／0 失败／0 flaky**，本例 28506 毫秒，retry 0，原 120 秒期限不变。

在原完整大小写、Unicode、NULL、精度、分组启停、面板键盘和导出流程中增加：两列排序、次列忽略大小写和 NULL LAST；暂存完整筛选及排序；清空两者后明确应用；一次撤销恢复全部七行，一次重做恢复 `1／3／6／7`；丢弃暂存保持当前视图，再沿原选择复制／CSV／JSON 导出。原审计仍为 `queries=1`、`exports=[csv,json]`、`pending=0`、`revision=0`，查询历史不变、pageErrors 为空。原 `finish`／`afterEach` 对客户端正常退出、原观察流关闭和任务结束的强制检查全部通过。

独立 Python 3.12.14 CLI PID **45504**，创建 UTC `19:09:35.1906215Z`，退出 UTC `19:09:35.3423144Z`，退出码 **0**。按既有独立脚本核对 4 行／8 列、18 个字符串／11 个 NULL／3 个二进制对象、列顺序与完整原文；读前后文件身份和摘要一致。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| CSV | 383 | `b0dc77e99c919b25c05b2282d554861f467f492c98fa35f764c3f579da6d27ce` |
| JSON | 827 | `c8f1958d36ae099ee13b0f9d4eed1c561d6212986664e2fdf7a95b6908ae9674` |

Root 记录在 `.cache/query-result-memory-ui-local-20261022`。独立重新读取封存清单中的 **27 项，0 不符**；本轮 **2121 项**跟踪源码／测试／脚本及实际构建输入前后不变，私有配置摘要不变，已知认证扫描 0 命中。原报告保留 53 个布局和 53 个完整行序附件。

- `result.json` SHA-256：`73cd1982339c04145bbd4c7279e243fe0eadfe513265f99a9a4a1dab5794a603`
- `manifest.json` SHA-256：`be90c90b5bd0a2b9486639220de71c03221b28f2791c0ea63d394c94d4e6ac3f`

## 范围

本轮原生验证为同一真实返回结果内的暂存／恢复整例。跨新查询手动复用、元数据差异、失败原子性、连接 ABA、旧回调及 SQL 失败后丢弃为真实 React RAM 测试，不能外推为这些情形的原生实测。新安装包、macOS、VM 小数视口仍未验；命名方案、跨标签和跨启动持久化尚未实现。

提交已推送 `origin/main`；源码推送没有发布版本。该提交 CI `39659090443` 已启动，完整终态另行回收；父提交的 CI 不替代本轮。暂不发布，不增加 Navicat 完整工作包计数。
