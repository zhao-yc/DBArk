# DBArk

面向 MySQL / MariaDB 的开源桌面数据库客户端。使用 Electron、React 和 TypeScript，采用 MIT 许可证。

DBArk 保留连接树、多标签查询和表格编辑等熟悉的工作方式，使用独立的界面与实现。当前开发范围为 Windows 和 macOS 客户端。

## 下载

在 [GitHub Releases](https://github.com/zhao-yc/DBArk/releases) 下载 Windows x64 安装程序、macOS arm64/x64 DMG 或 ZIP，以及源码和 SHA256 校验清单。`0.x` 为开发预览；Windows 未签名，macOS 仅有 ad-hoc 签名，没有发行证书及公证。安装步骤和数据保护边界见 [中文使用指南](docs/user-guide.md)。

已公开[0.17.0开发预览](https://github.com/zhao-yc/DBArk/releases/tag/v0.17.0)，增加全库搜索与本地查询检索、收藏及对象链接、XLSX、JSON计划树、窗口/LATERAL补全、JSON成员移动、Hex查看及多CSV ZIP归档。12个公开附件及890个源码文件已独立下载核对，公开Windows四批245项通过、0失败/跳过/重试，卸载及资源核零，见[公开发行验收](tests/integration/acceptance-v017-public-20261016.md)。其中218项走安装产品、27项为开发夹具/源码组件，另1项权限用例未执行。功能和限制见[0.17说明](docs/releases/v0.17.0.md)；本机3025单元、候选和公开安装分别验收，三平台原生源码/离线安装各68通过、178条件跳过，见[验收记录](tests/integration/acceptance-parallel-fourth-20261016.md)。

当前开发源码为0.18.0，完整3267项单元和类型检查通过；Windows表备注/默认编码六组合24次正式界面及TLS口令原生存储/真实重启两项均已验，见[表属性](tests/integration/acceptance-o01-table-properties-20261016.md)与[TLS](tests/integration/acceptance-c02-mtls-ui-20261016.md)。0.18尚未发布，新安装包/macOS实库继续；整表或现有列编码转换仍有独立工作包。

此前已公开[0.16.0 开发预览](https://github.com/zhao-yc/DBArk/releases/tag/v0.16.0)：增加 SQL 语义、会话临时对象和普通输出别名补全，并修正默认库、历史及布局的上下文。2089单元、六实例275核心通过13条件跳过；固定标签三平台源码和真实安装各24离线通过、123私网跳过。12个公开资产和608个源码文件下载核对一致，公开Windows安装包原147项完整通过，CSV/JSON各逐行校验百万行，卸载及资源独立核零。Q01仍为部分，macOS私网实库未验，详见[版本说明](docs/releases/v0.16.0.md)。



## 开发运行

需要 Node.js 24 和 pnpm 12.11.2。

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec install-electron
pnpm dev
```

开发页面固定使用 `127.0.0.1:5186`，端口被占用时会明确报错。终端显示 Vite 与客户端日志；关闭客户端或在运行终端按 Ctrl+C 停止。修改主进程或数据库引擎后需重启开发命令，界面修改支持热更新。

## 日常操作

1. 新建连接，填写主机、端口、账号和密码，可配置分组、颜色、SSH 和 TLS。
2. 双击或打开连接，选择数据库；打开表查看数据，或创建查询标签执行 SQL。
3. 查询支持执行选中内容、多语句脚本、历史、保存查询、执行计划和事务操作。每个查询标签使用独立数据库会话。
4. 网格与记录表单共用待提交草稿，暂存后预览 SQL 并集中保存。表没有可靠唯一键、使用非事务存储引擎或为视图时只读。
5. 表设计器预览 DDL 后执行；“字段差异编辑”“索引与主键差异”“外键差异”分别提供受控修改。0.17增加首批全文/空间索引；“结构比较”只生成审查稿，不能执行同步。数据库DDL通常隐式提交，支持范围及确认流程见中文指南。
6. 表导入导出支持CSV、JSON、SQL和首批XLSX；查询“新执行并完整导出”可将多个行集流式打包为CSV ZIP，执行前须确认这是一次新的SQL执行。

SSH 连接须填写可信主机的 SHA256 指纹。TLS 默认验证服务器证书；自签发证书应通过 CA 文件配置。密码在系统加密可用且选择记住时加密保存，否则只保留在当前应用会话。

客户端保留 BIGINT、DECIMAL 和日期时间的字符串表示，避免 JavaScript 数值精度及本机时区隐式转换。结果预览有可调行数及内存限制；完整数据导出通过独立流式任务完成。

## 检查与打包

```sh
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm dist:win
# 在 macOS 执行
pnpm dist:mac
```

产物位于 `release/`。GitHub Actions 分别在 Windows x64、macOS arm64 和 macOS x64 构建并验收；普通提交上传工作流附件。维护者推送与 `package.json` 版本一致的 `v*` 标签后，只有全部检查通过才发布开发预览、源码 ZIP 和 SHA256 清单。

数据库集成测试需要显式配置测试连接，参见 [开发与测试](docs/development.md)。支持目标、已验证版本和当前限制以 [验证记录](docs/validation.md) 为准。

## 本地数据与文档

配置、查询历史、保存的查询和任务记录保存在系统用户数据目录的 `DBArk/dbark.sqlite`。密码密文依赖当前系统用户的加密服务，复制配置库到另一台电脑后可能需要重新输入密码。

- [技术架构](docs/architecture.md)
- [中文使用指南](docs/user-guide.md)
- [功能对照](docs/feature-matrix.md)
- [REA 分析证据](docs/reverse-engineering.md)
- [开发与测试](docs/development.md)
- [验证记录](docs/validation.md)
- [版本记录](CHANGELOG.md)

持续开发目标为覆盖 Navicat 全部功能，按高频工作流程优先推进。已发布能力与后续缺项详见 [全功能覆盖清单](docs/navicat-coverage.md) 和 [路线图](docs/roadmap.md)。
