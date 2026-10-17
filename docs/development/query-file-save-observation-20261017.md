# SQL文件离线连接保存阶段被动观察

Root后续整合已在`tests/e2e/query-files.spec.ts`的原`openOfflineQuery`接入观察器，捕获同一Page、Electron应用、dataDir和原TestInfo。原一次点击、原隐藏断言和原超时不变，成功只卸载，失败才附脱敏观察且重抛原错误。`run1440`的44项相关RAM检查、类型及默认关闭的5项测试列表通过；尚未执行新的原生检查，原Windows安装失败的原因仍未确认。

本片从Root固定基线`70d0a069b14cfc1ef91d0c4d92f6c0b30103edfe`建立独立普通clone，分支`codex/employee2-query-file-save-observation-20261017`。只新增测试helper、专属RAM DOM单测及本文，不改产品、共享fixture或query-files.spec.ts。它用于补足原Windows安装验收第三例的保存阶段证据，不推断modal仍visible的根因，也不改变保存行为。

## Root接入位置

Root在openOfflineQuery原字段填写完成、原保存click之前，调用beginQueryFileSaveObservation。传入原page、原dialog Locator及捕获owner的同步检查函数；原click和原toBeHidden断言保持原次数与原超时，helper不会替它们执行或重试。

```ts
const ownerPage = page, ownerDesktop = desktop;
const observation = await beginQueryFileSaveObservation(ownerPage, connection, () => {
  if (page !== ownerPage || desktop !== ownerDesktop || ownerPage.isClosed()) throw Error('保存观察所属owner变化');
});
try {
  // 仍是原有的一次保存点击与原断言；不添加submit、validity方法或重试。
  await connection.getByRole('button', { name: '保存连接', exact: true }).click();
  await expect(connection).toBeHidden();
} catch (original) {
  await observation.failure(original, (name, data) => testInfo.attach(name, data));
} finally {
  await observation.detach();
}
```

该示例仅供Root后续接入，当前没有修改query-files.spec.ts。成功只有detach，不查profile、不采集快照、不attach。安装失败也不代替原保存动作；失败取证或attach失败仍重抛同一个original对象，不把辅助错误作为新根因，不增加任何重试或超时。

## 记录范围

在给定dialog中固定原form和唯一type=submit按钮，安装私有页面RAM marker及document的passive capture监听。只记录属于原按钮的click、原form的submit及原form控件的invalid事件，包含计数、isTrusted分桶和捕获时defaultPrevented计数。每类最多保留最后一个原事件的RAM引用；失败时再读取该事件最终defaultPrevented与isTrusted，避免把捕获阶段早于React preventDefault误说成未阻止。不会发送事件、调用click／submit／preventDefault、改变传播或改写React／readonly preload／IPC。

失败时只读控件disabled／required／readOnly／willValidate及ValidityState布尔，以原DOM序号定位；绝不调用checkValidity／reportValidity，不读取value、validationMessage、字段名称、错误正文或任何路径。额外输出原dialog／form／按钮isConnected、按钮disabled及ErrorBox存在布尔。控制项最多16条，并按序列化预算进一步截断；计数饱和到1024并标overflow，整体UTF-8附件不超过4096字节。

只有失败且原document和原dialog仍属于本例时，才调用一次真实公共connections.list。在页面内仅比较本例已知离线配置SQL文件用例的名称、127.0.0.1、端口1、offline及mysql，返回匹配数量和读取成功布尔；原profile不跨回Node，不读其认证、默认库、SQL或路径，不附带异常正文。这个数量只表示配置存在，不证明提交事件或关闭动作发生。

首次owner检查失败后本地永久停止，改回不能重新采集。旧token不能卸载新owner的marker，已有观察器不能被另一观察器覆盖；原dialog或控件脱离时不再记录新form事件，pagehide自动释放原document监听和事件引用。失败收集也最终detach，不修正表单、关闭窗口或清理业务现场。

## 四组最小验证

1. RAM原click＋invalid而无submit，ValidityState显示valueMissing；验证不调用validity方法、不多发事件、失败才读取一次匹配数量。
2. RAM submit在后续处理器preventDefault，失败附件能看见最终true；ErrorBox存在、匹配数1，且即使40控件也有界截断，不读取或附带任何字段／原profile／断言私料。
3. 成功只detach，零connections.list和附件；并验证重复安装不覆盖原观察器，pagehide卸载。
4. owner变化、卸载、读取或attach失败仍保留原断言；旧session不能接管新owner，重复failure不重复读取。

全部仅用RAM DOM和原Event对象模拟，不模拟浏览器原生约束验证机制，不代表Windows原生／安装包验收。无GUI、DB、原生文件、系统clipboard、私料读取、full或build。Root基线70d已有公共ui-explain-plan-state VM夹具缺visibleColumns的CI边界，Root统一处理，本片不改该文件。

准备命令：

```powershell
node D:/svn/DBArk/node_modules/vitest/vitest.mjs run tests/unit/query-file-save-observation.test.ts --maxWorkers=1 --reporter=json --outputFile=.cache/query-file-save-observation/accepted.json
node D:/svn/DBArk/node_modules/typescript/bin/tsc --noEmit
```

原生保存失败的真实事件、validity和配置匹配证据仍待Root接入并在明确的原生任务owner内采集。当前根因保持未知，不将RAM测试当作已复现安装包故障。

本片本地专项实际结果：4组全部通过，0失败、0跳过；TypeScript类型检查退出码0。上述结果仅覆盖RAM DOM辅助器，尚未接入或执行原生保存流程。
