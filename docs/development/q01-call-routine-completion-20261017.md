# Q01 CALL过程名补全最小切片（2026-10-17）

固定父版903f953eb6ce11cf05949af7d48e738d53632054。父版已有受权限约束的function/procedure目录和表达式函数补全；但CALL名称位置的语法候选为空，现有procedure目录没有进入分析到建议的真实链路。本轮选择这个缺口，不全量重写例程解析。

## 父红新绿

真实analyzeCompletion与completionSuggestions管道的两个原反例：

- CALL re|suffix：父版无procedure语义、目录读取为空；新实现只读当前默认库的procedure/prefix=re，插入`rebuild`引用文本，替换整个旧suffix，不加参数、括号或片段。
- CALL `lib.x`.`re|suffix`(1)：父版同样零读取；新实现只读lib.x过程目录，保持限定库与已有参数原文。

父版0通过/2失败；实现后原两例2通过。原始JSON和日志在独立普通克隆.cache/q01-call-routines，未使用worktree，未改动c027/710冻结交付。

## 范围与边界

新增completionProcedureScope.ts仅识别当前语句首部CALL后的最终过程名：未限定名或database.procedure。依托现有词法语句/引号/模式结果，名称替换后的整条CALL须通过现有静默MySQL校验器；原token未闭合不能借脱敏后的字面量恢复。参数内不进入过程名称分支。

支持无参数括号省略、已有完整参数列表、引用库/名称、注释和换行，以及当前DELIMITER语句边界。未知双引号模式、未闭合引号/参数、三段限定、动态变量名称、非法后缀保守停止。CREATE/BEGIN复合体中的过程调用不在本切片。

本功能只完成名称补全，不检查参数个数/类型/OUT变量、服务器例程是否能实际执行，也不执行用户CALL。CALL参数内部的函数名在本反例位置父版仍无语法候选，本轮保持该边界；既有SELECT表达式function目录继续回归，不声称全部例程补全完成。

## 权限与共享边界

复用既有CompletionAnalysisReady.syntax=['procedure']和metadata objects/procedure契约，无新IPC、请求字段或Worker结果字段。不读参数元数据、不列举全server；无默认库且未明确库名时零目录读取，限定库只读一个目标。会话覆盖层对例程继续转交既有永久目录，不探测临时表。

Engine现有information_schema.ROUTINES按ROUTINE_SCHEMA、ROUTINE_TYPE和转义前缀过滤，维持原权限及256项返回预算。本轮未修改Engine/main、公共sqlCompletion/contracts/commands/validation、目录缓存、会话目录、宿主、TableTab、提交回执、依赖或集中文案；“存储过程”直接复用completionZh.procedure。

与窗口修复仅有completionAnalysis.ts文件重叠：新增import及normalizedTokens后的CALL早返回，位于旧窗口处理之前，未改窗口能力gate。903f已有离线窗口能力回归由Root另行统筹，本切片的纯验证不能替代其原生修复验收。

## 官方依据

[MySQL 8.4 CALL手册](https://dev.mysql.com/doc/refman/8.4/en/call.html)说明CALL调用既存存储过程，无参数时括号可省略。[MariaDB CALL手册](https://mariadb.com/docs/server/reference/sql-statements/stored-routine-statements/call)明确允许database.procedure、反引号限定名称和完整参数。本轮不把MySQL解析库当作MariaDB全部语法兼容证明。

## 验证

相关22文件571项全部通过，0失败/跳过，新增CALL40项；覆盖实际分析/建议、真实CompletionDirectory及SessionCompletionDirectory、UTF16全文替换、引号、四模式、参数/注释隔离、单库读取、权限拒绝、截断、预算、取消和日志不回显。原补全测试无修改。

命令均在独立克隆执行，守卫禁止网络、任意原生进程、私有配置和密钥生成，只允许锁定esbuild隐藏编译器；缓存和依赖连接均只指向本克隆：

- node --require ./.cache/q01-call-routines/guard-compiler.cjs node_modules/vitest/vitest.mjs run --config .cache/q01-call-routines/vitest.config.mts
- node --require ./.cache/q01-call-routines/guard-compiler.cjs node_modules/typescript/bin/tsc --noEmit
- node --require ./.cache/q01-call-routines/guard-compiler.cjs scripts/build.mjs

GUI、200、数据库、系统剪贴板和手动CI实际执行均为0。本轮没有新增正式UI或重复控制helper；后续由Root安排独立原生验证，不将纯测试或构建计作服务器/用户输入验收。

最终类型检查退出0，生产构建退出0；构建保留已有大分块提示。测试/类型/构建日志与源码摘要在本克隆.cache/q01-call-routines交付清单。
