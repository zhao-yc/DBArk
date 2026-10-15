# 补全服务器事实的纯内存缓存

日期：2026-10-16。分支：`task/parallel-completion-server-facts-20261016`。本模块只提供基础缓存；App、Sidebar、store、SqlEditor及IPC接线由统筹集成，本提交不修改它们。

## 导出接口

`src/renderer/completionServerFacts.ts` 导出 `CompletionServerFacts` 类与 `completionServerFacts` 单例，同时导出只读ticket和值的类型：

```ts
begin(connectionId: string, revision: number): CompletionServerFactsTicket;
complete(ticket: CompletionServerFactsTicket, status: ConnectionStatus): boolean;
fail(ticket: CompletionServerFactsTicket): void;
clear(connectionId: string): void;
get(connectionId: string, revision: number):
  Readonly<Pick<ConnectionStatus, 'dialect' | 'version'>> | undefined;
```

ticket只含逻辑连接ID和连接配置修订，返回时冻结。每次begin都创建新的对象身份，即使同ID、同revision也不复用旧ticket。complete只接受仍在本实例中pending的精确同一ticket；成功一次后再次complete返回false。

## 生命周期与迟到边界

- begin替换同ID旧pending或已完成事实。revision须为非负安全整数，包含0；非法revision返回不可用的冻结ticket，并撤销同ID旧状态，不保留旧事实兜底。
- complete成功时只显式摘取dialect、version并冻结新对象；不展开源status，不保存它的物理connectionId或其它字段。源对象后续变化不会影响快照。
- 方言只接受mysql、mariadb。版本须为非空、非全空白字符串，最多256个UTF-16代码单元；保留原始文字和发行版后缀，不裁剪、截断或推测方言/能力。
- 当前pending的非法完成返回false并消费该pending；同ticket不能在之后补入其它状态，必须由调用方明确begin新尝试。旧ticket的非法完成不会删除当前新状态。
- fail只删除仍pending的同ticket。已完成建连后，后续目录权限等错误即使调用fail，也不会抹掉真实版本事实。
- clear只删除指定逻辑连接的条目，用于连接修改、断开、删除。旧响应在clear后、同ID重新begin后均不能复活。
- get必须精确匹配revision，只返回已完成的冻结事实。pending、未知或错误修订返回undefined；错误读取不删除其它修订事实。
- 相同字段的复制ticket、跨实例ticket都不能完成或删除当前pending。读取返回字段期间发生clear/替换也会在提交前重新核对ticket，不能重新插入旧条目。

逻辑连接ID沿用公开命令的1至200个代码单元边界，精确保留大小写、点号、Unicode和原型同名字符串；Map不把这些名称解释成对象属性。非法ID的begin不占容量，也不会挤走其它连接。

## 有界LRU

默认最多256项，pending与已完成事实合计计数。构造可传0至256的整数，便于小容量时序验收；0明确禁用缓存，负数、小数、非数及大于256的容量抛出中文RangeError，不允许放宽硬上限。

begin、新的有效complete、命中已完成事实的get均按最近使用刷新顺序。pending读取、错误修订读取、旧成功、旧失败和重复完成不刷新LRU。超容量时撤销最老条目；被淘汰的ticket即使之后返回成功也不能重建事实。

模块没有持续增长的修订墓碑、额外ticket注册表、TTL或计时器；缓存只持有最多256个当前ticket及有界字符串，旧ticket是否仍被调用方持有不会让缓存重新认识它。

## 集成约定与能力优先级

数据只来自调用方现有已完成的connections.open结果。统筹在原open开始前捕获逻辑连接ID及revision并begin，原open成功后complete，失败时fail；连接生命周期变化时clear。不为取得事实新增任何请求、探测SQL、认证或存储。

本模块没有物理会话忙碌、断开或事务状态，不能据此证明某个物理会话当前可补全。统筹仍优先采用真实物理会话缓存的方言版本；不得让本池事实覆盖busy/broken会话，未知事实也不能拿配置里的猜测版本填充。

## 文件范围与验证

仅新增三个文件：本模块、`tests/unit/completion-server-facts.test.ts`、本说明。单元测试直接执行纯同步缓存，不模拟数据库；覆盖同ID同/不同修订乱序、clear/fail后迟到、已完成事实保留、跨实例及复制ticket、源对象变动、版本及修订非法值、默认256项和小容量LRU、pending计入容量及淘汰后不可复活。

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/completion-server-facts.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

本地实际结果：专属单元59/59通过，0失败、0跳过；全工程 `tsc --noEmit` 通过。另将本模块单独按browser/ES2022打包通过，metafile只有 `src/renderer/completionServerFacts.ts` 一个源码输入、没有运行时依赖，输出3913字节；产物与报告仅在忽略缓存 `.cache/f02-excel/`。

本轮不启动GUI、键盘或系统剪贴板，不访问200或凭据，不执行Docker。模块导入仅包含ConnectionStatus的类型导入，运行时零IPC、网络、SQL和磁盘/浏览器持久化。单元与类型检查不代表实际App/Sidebar接线、物理会话优先级或服务器验收通过；这些由统筹后续集成确认。
