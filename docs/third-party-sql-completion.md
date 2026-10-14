# SQL 补全解析依赖

0.16 开发源码使用以下第三方组件，只编入本地 Worker。编辑器分析不会上传 SQL。它们属于构建依赖，安装程序不重复携带未使用的其它方言解析包。

| 组件 | 固定版本 | 包内许可 |
| --- | --- | --- |
| [dt-sql-parser](https://github.com/DTStack/dt-sql-parser) | 4.5.1 | MIT，DTStack |
| [antlr4-c3](https://github.com/mike-lischke/antlr4-c3) | 3.3.7 | MIT，Mike Lischke |
| [antlr4ng](https://github.com/mike-lischke/antlr4ng) | 2.0.11 | BSD-3-Clause，The ANTLR Project |

构建时从实际解析的包入口定位依赖、核对版本和声明的许可证，将原始许可全文复制到 `dist/renderer/third-party/`，同时生成 `sql-completion.json` 索引。该目录随 `dist` 进入应用包。改变上述依赖时须同步核对实际许可和构建清单。DBArk 自主代码继续使用仓库根目录的 MIT 许可；第三方版权原文保留其原语言。
