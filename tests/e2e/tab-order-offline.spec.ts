import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, restartOwnedDesktop, dataDir, pageErrors } from './desktop-fixture';
import { zh } from '../../src/renderer/locales/zh-CN';

// 仅使用本轮临时profile和合成本地配置，不读取认证或数据库资源。
test.skip(process.env.DBARK_INTEGRATION_ENABLED !== '0', '标签重排仅在integration=0的独立离线profile执行');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(120000); test.describe.configure({ mode: 'serial', retries: 0 });
let completed = false;
test.afterEach(({}, info) => { if (!completed) { retainOwnedDesktopResources(info); throw Error('标签重排原生生命周期未闭合，保留原App/profile'); } });

/** 用同名标签的准确ID做真实拖拽和键盘重排，编辑器与来源保持，并在新进程重开同一原profile。 */
test('真实拖拽及键盘重排保持活动查询和Monaco，正常退出后原顺序完整恢复', async ({ trace, screenshot, video }, info) => {
  let captured = ownedDesktopResources(info), application = captured.application, page = captured.page, originalProcess = application.process(); const directory = dataDir;
  let closed = false, armed = false, stage = '初始准备';
  const check = () => { const current = ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || dataDir !== directory || info.timeout !== 120000 || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1) throw Error('标签重排原App/profile/单例期限变化'); };
  const audit = () => application.evaluate(() => { const value = (globalThis as any).__tabOrderOffline; value.check(); return { pending: value.pending as number, denied: value.denied as string[], engineStarts: value.engineStarts as number, calls: value.calls as { command: string; ok: boolean }[], writes: value.writes as string[][] }; });
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const value = await action(); check(); if (armed && !closed && !skipAuditAfter) await audit(); return value; };
  const a = 'order-active', b = 'order-inactive-b', c = 'order-inactive-c', initialSql = '-- 原活动查询🚢\nSELECT :id AS original;', edit = ' -- 最新本地编辑😀';
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]);
    expect((await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})))).tabs).toEqual([]);
    // 正式Main准备本地连接与查询来源；不把配置准备声称成连接或查询创建UI验收。
    const prepared = await step(() => page.evaluate(async input => {
      const profiles = [];
      for (const [id, name, host] of [['tab-order-profile-a', '重排离线甲', 'offline-order-a.example.invalid'], ['tab-order-profile-b', '重排离线乙', 'offline-order-b.example.invalid']]) profiles.push(await window.dbark.invoke('connections.save', { id, name, host, port: 3306, user: 'offline-only', group: '标签重排离线', color: '#567890', dialect: 'mysql', database: '配置默认库', rememberPassword: false }));
      const source = await window.dbark.invoke('queries.create', { name: '原来源绑定查询', connectionId: profiles[0].id, context: { state: 'known', database: '原活动库' }, sql: input.initialSql });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, activeTabId: input.a, tabs: [
        { id: input.a, kind: 'query', title: '同名查询', connectionId: profiles[0].id, database: '原活动库', databaseContext: { state: 'known', database: '原活动库' }, sql: input.initialSql, sourceBinding: source.source },
        { id: input.b, kind: 'query', title: '同名查询', connectionId: profiles[1].id, databaseContext: { state: 'known', database: null }, sql: '-- 隐藏乙\nSELECT 2;' },
        { id: input.c, kind: 'query', title: '同名查询', connectionId: profiles[0].id, databaseContext: { state: 'unknown' }, sql: '-- 隐藏丙\nSELECT 3;' },
      ] }); return { profiles, source };
    }, { a, b, c, initialSql }));
    expect(prepared.profiles.every(profile => profile.password === undefined && profile.rememberPassword === false)).toBe(true);
    // 沿既有历史插入例启用官方只读API，测试不调用setValue/setSelection/executeEdits。
    await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; })); await step(() => page.reload());
    const query = () => page.locator('.query-tab:visible'), box = () => query().locator('.monaco-editor').getByRole('textbox');
    await step(() => expect(page.locator('.query-tab')).toHaveCount(3)); await step(() => expect(box()).toBeVisible());
    /** 原真实模型的URI、版本和正文共同核对；隐藏模型也必须保留，顺序不作为模型身份。 */
    const observe = () => step(() => page.evaluate(() => {
      const editors = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab'));
      if (editors?.length !== 3) throw Error('标签重排的三个原查询编辑器不完整');
      return editors.map(editor => { const model = editor.getModel(); if (!model || model.isDisposed()) throw Error('标签重排原模型已失效'); return { uri: model.uri.toString(), version: model.getVersionId(), value: model.getValue(), eol: model.getEOL(), visible: editor.getContainerDomNode().getClientRects().length > 0 }; }).sort((left, right) => left.uri.localeCompare(right.uri));
    }));
    await step(() => expect.poll(async () => (await observe()).length).toBe(3)); const initialModels = await observe(), activeModel = initialModels.find(model => model.visible)!; expect(initialModels.filter(model => model.visible)).toHaveLength(1);
    const original = initialSql.replaceAll('\n', activeModel.eol), edited = original + edit;
    // Monaco键盘输入在“--”后的空格前分组；insertText并不保证整串只有一个Undo元素。
    const undoIntermediate = original + ' --'; expect(activeModel.value).toBe(original);
    /** 正常400ms保存和真实Monaco正文都完成才冻结基线，不能把旧配置当作最新SQL。 */
    const exact = async (sql: string) => {
      await step(() => expect.poll(async () => (await observe()).find(model => model.uri === activeModel.uri)?.value).toBe(sql));
      await step(() => expect.poll(async () => { const value = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return value.tabs.find(tab => tab.id === a)?.sql; }).toBe(sql));
    };
    await step(() => box().focus()); await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')); await step(() => page.keyboard.insertText(edit)); await exact(edited);
    const baseline = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))), models = await observe(); expect(baseline.activeTabId).toBe(a); expect(baseline.tabs.map(tab => tab.id)).toEqual([a, b, c]); expect(baseline.tabs[0].sourceBinding).toEqual(prepared.source.source); expect(baseline.tabs.every(tab => tab.fileSourceBinding === undefined)).toBe(true);
    /** 原无会话/结果的UI事实单独保存，不以零连接状态冒称活动事务通过。 */
    const effects = () => step(async () => ({ profiles: await page.evaluate(() => window.dbark.invoke('connections.list', {})), sources: await page.evaluate(() => window.dbark.invoke('queries.list', {})), tasks: await page.evaluate(() => window.dbark.invoke('tasks.list', {})), history: await page.evaluate(() => window.dbark.invoke('history.list', {})), context: await query().getByLabel('当前查询默认库', { exact: true }).textContent(), connection: await query().locator('.query-context-target > strong').textContent(), session: await query().locator('.context-bar').getByText(zh.query.text009, { exact: true }).textContent(), result: await query().locator('.result-body').textContent(), grids: await query().locator('.result-body [role="grid"]').count(), commitDisabled: await query().getByRole('button', { name: zh.common.transactionCommit, exact: true }).isDisabled(), rollbackDisabled: await query().getByRole('button', { name: zh.common.transactionRollback, exact: true }).isDisabled() }));
    const originalEffects = await effects(); expect(originalEffects.tasks).toEqual([]); expect(originalEffects.history).toEqual([]); expect(originalEffects.grids).toBe(0); expect(originalEffects.commitDisabled && originalEffects.rollbackDisabled).toBe(true); expect(originalEffects.context).toBe('原活动库'); expect(originalEffects.connection).toBe('重排离线甲');
    /** Main只透传本地请求；只允许原三个标签置换，以及原活动SQL的真实Undo/Redo，不放开DB或其它配置写。 */
    const arm = () => step(() => application.evaluate(({ ipcMain, BrowserWindow, utilityProcess }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], frame = window?.webContents.mainFrame, originalFork = utilityProcess.fork;
      if (!previous || windows.length !== 1 || !frame || root.__tabOrderOffline) throw Error('标签重排Main旁观入口未知');
      const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item), sql = new Set(input.sql), rows = new Map(input.baseline.tabs.map(tab => [tab.id, tab]));
      const state = { pending: 0, denied: [] as string[], denialDetails: [] as unknown[], engineStarts: 0, calls: [] as { command: string; ok: boolean }[], writes: [] as string[][], check() {}, restore() {}, facts(): unknown { return undefined; } };
      /** 失败标签只描述原比较门，不读取正文或凭据，也不把已拒绝请求重新交给产品。 */
      const failures = () => { const gates: string[] = []; if (root.__tabOrderOffline !== state) gates.push('observer身份'); if (handlers.get('dbark:request') !== wrapped) gates.push('Main-handler身份'); if (utilityProcess.fork !== blocked) gates.push('utility-fork守卫'); if (window.isDestroyed()) gates.push('原窗口已销毁'); else if (window.webContents.mainFrame !== frame) gates.push('原Main-frame身份'); if (BrowserWindow.getAllWindows().length !== 1) gates.push('窗口数'); if (state.denied.length) gates.push('已拒绝命令'); return gates; };
      const check = () => { const gates = failures(); if (gates.length) throw Error('标签重排原Main/文档旁观变化：' + JSON.stringify({ gates, denied: state.denied, denialDetails: state.denialDetails })); };
      const deny = (command: string, detail?: unknown): never => { state.denied.push(command); if (detail !== undefined) state.denialDetails.push({ command, detail }); throw Error('离线标签重排拒绝数据库/剪贴板或未知写入：' + command + (detail === undefined ? '' : '；' + JSON.stringify(detail))); };
      const blocked = ((..._args: unknown[]) => { state.engineStarts++; return deny('utilityProcess.fork'); }) as typeof utilityProcess.fork;
      const local = new Set(['settings.get', 'settings.save', 'connections.list', 'tasks.list', 'history.list', 'queries.list', 'app.info', 'app.runtimeInfo', 'app.setDirty', 'app.menuState', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolFinish']);
      const wrapped = async (event: any, payload: any) => {
        check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来IPC'); const command = String(payload?.command), value = payload?.input; if (!local.has(command)) return deny(command);
        if (command === 'settings.save') {
          if (!value || stable({ ...value, tabs: undefined }) !== stable({ ...input.baseline, tabs: undefined }) || !Array.isArray(value.tabs) || value.tabs.length !== rows.size || new Set(value.tabs.map((tab: any) => tab.id)).size !== rows.size || value.tabs.some((tab: any) => { const original = rows.get(tab.id); return !original || (tab.id === input.active ? !sql.has(tab.sql) || stable({ ...tab, sql: undefined }) !== stable({ ...original, sql: undefined }) : stable(tab) !== stable(original)); })) {
            // 保留上方原完整拒绝条件；只记录合成配置的字段名与SQL分类，不附正文或连接字段值。
            const fields = (actual: any, expected: any, excluded: string[]) => [...new Set([...Object.keys(actual ?? {}), ...Object.keys(expected ?? {})])].filter(key => !excluded.includes(key) && stable(actual?.[key]) !== stable(expected?.[key]));
            return deny(command, { present: !!value, settingsFields: fields(value, input.baseline, ['tabs']), tabsArray: Array.isArray(value?.tabs), tabCount: Array.isArray(value?.tabs) ? value.tabs.length : null, expectedCount: rows.size, uniqueIds: Array.isArray(value?.tabs) ? new Set(value.tabs.map((tab: any) => tab.id)).size : null, tabs: Array.isArray(value?.tabs) ? value.tabs.map((tab: any) => { const original = rows.get(tab.id); return { id: tab.id, known: !!original, fields: fields(tab, original, ['sql']), sqlMatchesOriginal: tab.sql === input.sql[0], sqlMatchesEdited: tab.sql === input.sql[1], sqlMatchesUndoIntermediate: tab.sql === input.sql[2], sqlMatchesOwnBaseline: tab.sql === original?.sql, sqlLength: typeof tab.sql === 'string' ? tab.sql.length : null }; }) : [] });
          }
        }
        const fact = { command, ok: false }; state.calls.push(fact); state.pending++;
        try { const response = await previous(event, payload); check(); fact.ok = response?.ok === true; if (command === 'settings.save' && fact.ok) state.writes.push(value.tabs.map((tab: any) => tab.id)); return response; } finally { state.pending--; }
      };
      state.check = check; state.facts = () => ({ gates: failures(), pending: state.pending, denied: state.denied, denialDetails: state.denialDetails, engineStarts: state.engineStarts, calls: state.calls, writes: state.writes, pid: process.pid }); state.restore = () => { check(); if (state.pending || state.calls.some(call => !call.ok)) throw Error('标签重排原本地请求未收尾'); handlers.set('dbark:request', previous); utilityProcess.fork = originalFork; delete root.__tabOrderOffline; }; root.__tabOrderOffline = state; handlers.set('dbark:request', wrapped); utilityProcess.fork = blocked; check();
    }, { baseline, sql: [original, edited, undoIntermediate], active: a }));
    await arm(); armed = true;
    const tab = (id: string) => page.locator('.tab-strip [data-workspace-tab-id="' + id + '"]'), select = (id: string) => tab(id).locator('.tab-select'), stages: { action: string; ids: string[] }[] = [];
    /** 独立期望ID序列同时核DOM和Main落盘，不按同名文字定位，也不通过产品排序函数算答案。 */
    const order = async (ids: string[], action: string) => {
      stage = action;
      await step(() => expect.poll(async () => page.locator('.tab-strip [data-workspace-tab-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-workspace-tab-id')))).toEqual(ids));
      await step(() => expect.poll(async () => { const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return settings.tabs.map(tab => tab.id); }).toEqual(ids));
      const settings = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(settings).toEqual({ ...baseline, tabs: ids.map(id => baseline.tabs.find(tab => tab.id === id)!) }); expect(settings.activeTabId).toBe(a); await step(() => expect(tab(a)).toHaveAttribute('data-active-workspace-tab', 'true')); expect(await observe()).toEqual(models); expect(await effects()).toEqual(originalEffects); stages.push({ action, ids: [...ids] });
    };
    /** 仅tab-select实际持焦点时的快捷键可重排；inactive按钮focus本身不激活标签。 */
    const key = async (id: string, value: string, ids: string[]) => { await step(() => select(id).focus()); await step(() => expect(select(id)).toBeFocused()); await step(() => page.keyboard.press('ControlOrMeta+Shift+' + value)); await order(ids, '键盘 ' + id + ' ' + value); };
    /** locator.dragTo使用真实鼠标HTML5拖拽；drop侧由目标wrapper的真实clientX决定。 */
    const drag = async (source: string, target: string, side: 'before' | 'after', ids: string[]) => {
      const bounds = await step(() => tab(target).boundingBox()); if (!bounds || bounds.width < 12 || bounds.height < 8) throw Error('标签拖拽目标没有有效原生区域');
      await step(() => select(source).dragTo(tab(target), { targetPosition: { x: side === 'before' ? 2 : bounds.width - 2, y: bounds.height / 2 } })); await order(ids, '鼠标 ' + source + ' ' + side + ' ' + target);
    };
    await order([a, b, c], '初始'); await key(b, 'ArrowRight', [a, c, b]); await key(b, 'Home', [b, a, c]); await key(b, 'End', [a, c, b]); await drag(b, a, 'before', [b, a, c]); await drag(b, c, 'after', [a, c, b]); await drag(a, b, 'after', [c, b, a]); await key(a, 'Home', [a, c, b]); await key(a, 'End', [c, b, a]);
    // 编辑器自身的组合键不能穿透为标签命令，原SQL/模型版本及顺序不变。
    await step(() => box().focus()); await step(() => page.keyboard.press('ControlOrMeta+Shift+ArrowLeft')); await order([c, b, a], '编辑器组合键不穿透');
    stage = '真实Undo首组与准确中间正文'; await step(() => page.keyboard.press('ControlOrMeta+Z')); await exact(undoIntermediate);
    stage = '真实Undo次组与原文持久化'; await step(() => page.keyboard.press('ControlOrMeta+Z')); await exact(original); const undone = await observe(); expect(undone.map(model => model.uri)).toEqual(models.map(model => model.uri)); expect(undone.filter(model => model.uri !== activeModel.uri)).toEqual(models.filter(model => model.uri !== activeModel.uri)); expect(await effects()).toEqual(originalEffects);
    stage = '真实Redo首组与准确中间正文'; await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y')); await exact(undoIntermediate);
    stage = '真实Redo次组与最新正文持久化'; await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y')); await exact(edited); expect((await observe()).find(model => model.uri === activeModel.uri)?.uri).toBe(activeModel.uri); expect(await effects()).toEqual(originalEffects);
    const final = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(final).toEqual({ ...baseline, tabs: [c, b, a].map(id => baseline.tabs.find(tab => tab.id === id)!) }); const first = await step(audit); expect(first.pending).toBe(0); expect(first.denied).toEqual([]); expect(first.engineStarts).toBe(0); expect(first.calls.every(call => call.ok)).toBe(true); expect(first.writes.some(ids => ids.join() === [c, b, a].join())).toBe(true); expect(pageErrors).toEqual([]);
    // 原观察器撤销后不得再after-audit；先严格正常退出，再调用夹具唯一owned重启端口。
    stage = '首owner正常退出'; await step(() => application.evaluate(() => (globalThis as any).__tabOrderOffline.restore()), true); armed = false; check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0); const firstPid = originalProcess.pid;
    stage = '同profile独立owned重启'; await restartOwnedDesktop(info); captured = ownedDesktopResources(info); application = captured.application; page = captured.page; originalProcess = application.process(); closed = false; check(); expect(originalProcess.pid).not.toBe(firstPid); expect(dataDir).toBe(directory);
    await step(() => expect(page.locator('.query-tab')).toHaveCount(3)); await step(() => expect(box()).toBeVisible()); const restored = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {}))); expect(restored).toEqual(final); expect(await effects()).toEqual(originalEffects); expect(await step(() => page.locator('.tab-strip [data-workspace-tab-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-workspace-tab-id'))))).toEqual([c, b, a]); await step(() => expect(tab(a)).toHaveAttribute('data-active-workspace-tab', 'true')); await step(() => expect(query().locator('.monaco-editor .view-lines')).toContainText('最新本地编辑😀'));
    // 重启后的零DB观察仅涵盖新App就绪后；启动前半段不冒充已安装观察器。
    await arm(); armed = true; expect(await effects()).toEqual(originalEffects); const second = await step(audit); expect(second.pending).toBe(0); expect(second.denied).toEqual([]); expect(second.engineStarts).toBe(0); expect(second.calls.every(call => call.ok)).toBe(true); expect(pageErrors).toEqual([]);
    await step(() => application.evaluate(() => (globalThis as any).__tabOrderOffline.restore()), true); armed = false; check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0);
    await step(() => info.attach('标签重排离线真实鼠标键盘与owned重启', { body: JSON.stringify({ kind: 'dbark.tab-order-offline', stages, finalIds: restored.tabs.map(tab => tab.id), activeTabId: restored.activeTabId, originalModelUris: models.map(model => model.uri), originalModelVersionsPreservedDuringMoves: true, undoRedoPreserved: true, keyboardUndoGroups: 2, keyboardRedoGroups: 2, sameNameQueries: 3, offlineConnections: 2, sourceBindingPreserved: true, absentFileBindingsPreserved: true, inactiveMoveDidNotActivate: true, editorShortcutDidNotReorder: true, firstOwnedExitCode: 0, secondOwnedExitCode: originalProcess.exitCode, firstPid, secondPid: originalProcess.pid, sameProfileDirectory: true, restartRestoredExactSettings: true, observedDatabaseRequests: first.denied.length + second.denied.length, observedUtilityForks: first.engineStarts + second.engineStarts, clipboardOperationsByTest: 0, observationScope: '首App本地准备/reload稳定后至正常退出前；次App就绪后至正常退出前', unverified: ['混合表页（现隐藏表页会自动读取数据库，本离线例未造替身）', '拖拽进行中同时编辑/删除/换源/模态失效（core/UI单元另验）', '真实文件绑定', '活动数据库会话/结果/事务', '安装包', 'macOS'] }), contentType: 'application/json' }), true); completed = true;
  } catch (reason) {
    retainOwnedDesktopResources(info);
    // 诊断独立于check/step，只读原旁观事实；任何采集或附件失败都不能替换原首因与保留策略。
    const diagnostic: Record<string, unknown> = { stage, profile: directory, closed, armed, knownProcess: { pid: originalProcess.pid, exitCode: originalProcess.exitCode }, firstError: reason instanceof Error ? { name: reason.name, message: reason.message } : String(reason) };
    try { const current = ownedDesktopResources(info); diagnostic.owned = { sameApplication: current.application === application, samePage: current.page === page, closed: current.closed, pid: current.application.process().pid }; } catch (failure) { diagnostic.ownedReadError = String(failure); }
    try { diagnostic.main = await application.evaluate(() => { const value = (globalThis as any).__tabOrderOffline; return value ? value.facts() : { observerPresent: false, pid: process.pid }; }); } catch (failure) { diagnostic.mainReadError = String(failure); }
    try { await info.attach('标签重排原生失败只读诊断', { body: JSON.stringify(diagnostic), contentType: 'application/json' }); } catch { /* 附件失败仍抛出最初异常。 */ }
    throw reason;
  }
});
