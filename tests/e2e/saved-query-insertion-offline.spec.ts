import { test, expect, ownedDesktopResources, retainOwnedDesktopResources, confirmOwnedDesktopExit, dataDir, pageErrors } from './desktop-fixture';
import { zh } from '../../src/renderer/locales/zh-CN';
import { savedQueryPagesZh as pagesText } from '../../src/renderer/locales/savedQueryPages.zh-CN';
import { savedQuerySearchZh as searchText } from '../../src/renderer/locales/savedQuerySearch.zh-CN';
import { databaseSearchZh as structureText } from '../../src/renderer/locales/databaseSearch.zh-CN';
import { savedQueryInsertionZh as insertionText } from '../../src/renderer/locales/savedQueryInsertion.zh-CN';

// 复用现有离线桌面夹具，不读取认证、驱动、旧profile或数据库资源；不引入额外原生门。
test.skip(process.env.DBARK_INTEGRATION_ENABLED !== '0', '仅在integration=0的独立合成离线profile验收');
test.use({ preserveOnUnconfirmedExit: true, trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(120000);
test.describe.configure({ mode: 'serial', retries: 0 });
let completed = false;
test.afterEach(({}, info) => { if (!completed) { retainOwnedDesktopResources(info); throw Error('保存查询插入未完整收尾，保留所属App/profile与原回包状态'); } });

/** 两个入口都只将真实本地原文插入原选区，旧读取关闭后不能覆盖模型或污染Undo分组。 */
test('保存列表与全文搜索插入原查询选区、单次Undo/Redo、Escape拒绝真实迟到回包', async ({ trace, screenshot, video }, info) => {
  const captured = ownedDesktopResources(info), application = captured.application, page = captured.page, originalProcess = application.process(), directory = dataDir;
  const redoKey = process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y';
  let closed = false, armed = false;
  const check = () => { const current = ownedDesktopResources(info); if (current.application !== application || current.page !== page || current.closed !== closed || dataDir !== directory || info.retry !== 0 || info.repeatEachIndex !== 0 || info.config.workers !== 1 || info.timeout !== 120000) throw Error('保存查询插入的原App/profile/单例期限变化'); };
  const audit = () => application.evaluate(() => { const state = (globalThis as any).__savedQueryInsertionOffline; state.check(); return { pending: state.pending as number, held: state.held as boolean, calls: state.calls as { command: string; ok: boolean }[], reads: state.reads as { id: string; digest: string; sql: string; ok: boolean }[], engineStarts: state.engineStarts as number, denied: state.denied as string[], savedSql: state.savedSql as string[], searchTaskIds: state.searchTaskIds as string[] }; });
  const step = async <T,>(action: () => Promise<T>, skipAuditAfter = false): Promise<T> => { check(); if (armed && !closed) await audit(); const result = await action(); check(); if (armed && !closed && !skipAuditAfter) await audit(); return result; };
  const prefix = '-- 原查询前缀🚢\n', selected = 'REPLACE_ME', suffix = "\nSELECT '原查询后缀😀' AS 尾;", originalSql = prefix + selected + suffix;
  const listSql = "-- 跨连接来源：纯文本，未执行\n-- " + 'x'.repeat(650) + "\nUPDATE synthetic SET id=:list_id, note='$1 ${name} 😀';\n-- LIST_FULL_TAIL";
  const searchSql = "-- 未绑定来源：不需要选择打开连接\n-- " + 'y'.repeat(650) + "\nSELECT :search_id, '中文🚢', '${1:原文}';\n-- SAVED_INSERT_SQL_ONLY_完整尾部";
  try {
    check(); expect([trace, screenshot, video]).toEqual(['off', 'off', 'off']);
    expect(await step(() => page.evaluate(() => window.dbark.invoke('connections.list', {})))).toEqual([]);
    expect((await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})))).tabs).toEqual([]);
    // 正式Main本地配置准备；不冒称连接表单、新建查询UI或重启恢复验收。
    const prepared = await step(() => page.evaluate(async input => {
      const profiles = [];
      for (const [id, name, host] of [['saved-insert-target', '插入原连接', 'offline-target.example.invalid'], ['saved-insert-other', '保存来源其它连接', 'offline-source.example.invalid']]) profiles.push(await window.dbark.invoke('connections.save', { id, name, group: '保存查询插入离线', color: '#456789', dialect: 'mysql', host, port: 3306, user: 'offline-only', database: '配置默认库', rememberPassword: false }));
      const original = await window.dbark.invoke('queries.create', { name: '原来源绑定查询', connectionId: profiles[0].id, context: { state: 'known', database: '原查询库' }, sql: input.originalSql });
      const list = await window.dbark.invoke('queries.create', { name: '跨连接保存脚本', connectionId: profiles[1].id, context: { state: 'known', database: '保存来源库' }, sql: input.listSql });
      const search = await window.dbark.invoke('queries.create', { name: '未绑定保存脚本', context: { state: 'known', database: null }, sql: input.searchSql });
      const settings = await window.dbark.invoke('settings.get', {});
      await window.dbark.invoke('settings.save', { ...settings, tabs: [{ id: 'saved-insert-original-tab', kind: 'query', title: '保持原查询', connectionId: profiles[0].id, database: '原查询库', databaseContext: { state: 'known', database: '原查询库' }, sql: input.originalSql, sourceBinding: original.source }], activeTabId: 'saved-insert-original-tab' });
      return { original, list, search, profiles };
    }, { originalSql, listSql, searchSql }));
    expect(prepared.profiles.every(profile => profile.password === undefined && profile.rememberPassword === false)).toBe(true);
    // 只启用Monaco官方全局只读观察API，模型/选区及正文均由真实UI或原Main创建。
    await step(() => page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; }));
    await step(() => page.reload()); const frame = page.mainFrame(), query = page.locator('.query-tab:visible'), box = query.locator('.monaco-editor').getByRole('textbox'); await step(() => expect(box).toBeVisible());
    const observe = () => step(() => page.evaluate(() => {
      const editors = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab') && editor.getContainerDomNode().getClientRects().length > 0);
      if (editors?.length !== 1) throw Error('原查询Monaco编辑器不唯一'); const editor = editors[0], model = editor.getModel(); if (!model || model.isDisposed()) throw Error('原查询Monaco模型未知');
      return { value: model.getValue(), version: model.getVersionId(), eol: model.getEOL(), uri: model.uri.toString(), ranges: editor.getSelections()?.map(range => ({ start: model.getOffsetAt(range.getStartPosition()), end: model.getOffsetAt(range.getEndPosition()) })) };
    }));
    const initial = await observe(), normalize = (value: string) => value.replaceAll('\n', initial.eol), original = normalize(originalSql) + ' ', listInserted = normalize(prefix + listSql + suffix) + ' ', searchInserted = normalize(prefix + searchSql + suffix) + ' ';
    expect(initial.value).toBe(normalize(originalSql));
    /** 同时核真实模型与正式settings防抖保存，不以store结果冒充Monaco插入/撤销。 */
    const exact = async (value: string) => {
      await step(() => expect.poll(async () => (await observe()).value).toBe(value));
      await step(() => expect.poll(async () => { const value = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return value.tabs.find(tab => tab.id === value.activeTabId)?.sql; }).toBe(value));
    };
    // 先形成原查询未保存编辑，并等待真实400ms持久化完成，避免把初始旧值当作保存已稳定。
    await step(() => box.focus()); await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')); await step(() => page.keyboard.press('Space')); await exact(original);
    /** 保留外部Unicode/EOL，以真实键盘准确选择第二行ASCII哨兵。 */
    const select = async () => {
      await step(() => box.focus()); await step(() => page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home')); await step(() => page.keyboard.press('ArrowDown')); await step(() => page.keyboard.press('Home')); await step(() => page.keyboard.press('Shift+End'));
      expect((await observe()).ranges).toEqual([{ start: normalize(prefix).length, end: normalize(prefix).length + selected.length }]);
    };
    /** 仅离线原无结果/无会话的状态基线，不将其描述成活动事务验收。 */
    const effects = () => step(async () => {
      const stored = await page.evaluate(async () => { const settings = await window.dbark.invoke('settings.get', {}), tasks = await window.dbark.invoke('tasks.list', {}); return { activeTabId: settings.activeTabId, tabs: settings.tabs.map(({ sql: _sql, ...tab }) => tab), tasks: tasks.filter(task => task.kind !== 'search.savedQueries'), history: await window.dbark.invoke('history.list', {}), queries: await window.dbark.invoke('queries.list', {}) }; });
      return { ...stored, context: await query.getByLabel('当前查询默认库', { exact: true }).textContent(), connection: await query.locator('.context-bar > strong').textContent(), session: await query.locator('.context-bar').getByText(zh.query.text009, { exact: true }).textContent(), result: await query.locator('.result-body').textContent(), grids: await query.locator('.result-body [role="grid"]').count(), commitDisabled: await query.getByRole('button', { name: zh.common.transactionCommit, exact: true }).isDisabled(), rollbackDisabled: await query.getByRole('button', { name: zh.common.transactionRollback, exact: true }).isDisabled() };
    });
    const before = await effects(), baseline = await step(() => page.evaluate(() => window.dbark.invoke('settings.get', {})));
    expect(before.tabs).toHaveLength(1); expect(before.tabs[0].sourceBinding).toEqual(prepared.original.source); expect(before.tabs[0].fileSourceBinding).toBeUndefined(); expect(before.context).toBe('原查询库'); expect(before.connection).toBe('插入原连接'); expect(before.grids).toBe(0); expect(before.session).toBe(zh.query.text009); expect(before.commitDisabled && before.rollbackDisabled).toBe(true); expect(before.tasks).toEqual([]); expect(before.history).toEqual([]);
    // 沿原历史例只透传Main并延后一次原读回包；不替换正文、摘要、结果或模型。
    await step(() => application.evaluate(({ ipcMain, BrowserWindow, utilityProcess }, input) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), windows = BrowserWindow.getAllWindows(), window = windows[0], frame = window?.webContents.mainFrame, originalFork = utilityProcess.fork;
      if (!previous || windows.length !== 1 || !frame || root.__savedQueryInsertionOffline) throw Error('保存查询插入Main旁观入口未知');
      const stable = (value: unknown) => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
      const withoutSql = (value: typeof input.baseline) => ({ ...value, tabs: value.tabs.map(({ sql: _sql, ...tab }) => tab) });
      const allowedSql = new Set(input.sql), sources = new Map(input.sources.map(source => [source.id, source.sql]));
      const state = { pending: 0, calls: [] as { command: string; ok: boolean }[], reads: [] as { id: string; digest: string; sql: string; ok: boolean }[], savedSql: [] as string[], searchTaskIds: [] as string[], denied: [] as string[], engineStarts: 0, gateNext: false, held: false, release: undefined as (() => void) | undefined, check() {}, restore() {} };
      const check = () => { if (root.__savedQueryInsertionOffline !== state || handlers.get('dbark:request') !== wrapped || utilityProcess.fork !== blocked || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1 || state.denied.length) throw Error('保存查询插入Main原窗口或旁观归属变化'); };
      const deny = (command: string): never => { state.denied.push(command); throw Error('离线保存查询插入拒绝数据库/剪贴板或未知操作：' + command); };
      const blocked = ((..._args: unknown[]) => { state.engineStarts++; return deny('utilityProcess.fork'); }) as typeof utilityProcess.fork;
      const allowed = new Set(['settings.get', 'settings.save', 'connections.list', 'tasks.list', 'history.list', 'history.page', 'history.pageContinue', 'history.pageRelease', 'queries.list', 'queries.page', 'queries.pageContinue', 'queries.pageRelease', 'queries.organizationGet', 'queries.readText', 'search.savedQueries', 'search.savedQueriesContinue', 'search.savedQueriesRelease', 'query.cancel', 'app.info', 'app.runtimeInfo', 'app.setDirty', 'workbench.get', 'workbench.protocolReady', 'workbench.protocolTake', 'workbench.protocolFinish']);
      const wrapped = async (event: any, payload: any) => {
        check(); if (event.sender !== window.webContents || event.senderFrame !== frame) return deny('外来IPC'); const command = String(payload?.command), value = payload?.input; if (!allowed.has(command)) return deny(command);
        if (command === 'settings.save' && (stable(withoutSql(value)) !== stable(withoutSql(input.baseline)) || value.tabs.length !== 1 || !allowedSql.has(value.tabs[0].sql))) return deny(command);
        if (command === 'queries.readText' && (!value || Object.keys(value).sort().join() !== 'digest,id' || !sources.has(value.id) || !/^[a-f0-9]{64}$/.test(value.digest))) return deny(command);
        if (command === 'search.savedQueries') { if (state.searchTaskIds.length || typeof value?.taskId !== 'string') return deny(command); state.searchTaskIds.push(value.taskId); }
        const fact = { command, ok: false }; state.calls.push(fact); state.pending++;
        try {
          const response = await previous(event, payload); check(); fact.ok = response?.ok === true;
          if (command === 'settings.save' && fact.ok) state.savedSql.push(value.tabs[0].sql);
          if (command === 'queries.readText') {
            if (response?.ok !== true || response.result?.query?.id !== value.id || response.result.query.sql !== sources.get(value.id) || Object.keys(response.result).join() !== 'query') return deny('queries.readText原文回包');
            state.reads.push({ id: value.id, digest: value.digest, sql: response.result.query.sql, ok: fact.ok });
            if (state.gateNext) { state.gateNext = false; state.held = true; await new Promise<void>(resolve => { state.release = () => { if (!state.held) throw Error('原保存查询读取门已释放'); state.held = false; state.release = undefined; resolve(); }; }); check(); }
          }
          return response;
        } finally { state.pending--; }
      };
      state.check = check; state.restore = () => { check(); if (state.pending || state.held || state.gateNext || state.calls.some(call => !call.ok)) throw Error('原保存查询读取或本地任务未收尾'); handlers.set('dbark:request', previous); utilityProcess.fork = originalFork; delete root.__savedQueryInsertionOffline; };
      root.__savedQueryInsertionOffline = state; handlers.set('dbark:request', wrapped); utilityProcess.fork = blocked; check();
    }, { baseline, sql: [original, listInserted, searchInserted], sources: [{ id: prepared.list.source.id, sql: listSql }, { id: prepared.search.source.id, sql: searchSql }] })); armed = true;
    const history = () => page.getByRole('dialog', { name: zh.activity.text003, exact: true });
    /** 真实工作台入口先打开历史，再切保存页，沿同一捕获选区而不重新领当前编辑器。 */
    const openList = async () => { await step(() => page.locator('.app-commandbar').getByRole('button', { name: zh.common.historyQueries, exact: true }).click()); await step(() => history().getByRole('button', { name: zh.activity.text005, exact: true }).click()); await step(() => expect(history().getByRole('button', { name: pagesText.refresh, exact: true })).toBeEnabled()); };
    const card = () => history().locator('.history-card').filter({ has: page.getByText('跨连接保存脚本', { exact: true }) });
    /** Undo和Redo都必须一次真实按键恢复完整正文，来源绑定及原模型URI不变。 */
    const undoRedo = async (inserted: string) => {
      await step(() => box.focus()); await step(() => page.keyboard.press('ControlOrMeta+Z')); await exact(original); expect(await effects()).toEqual(before);
      await step(() => page.keyboard.press(redoKey)); await exact(inserted); expect(await effects()).toEqual(before);
      await step(() => page.keyboard.press('ControlOrMeta+Z')); await exact(original); expect((await observe()).uri).toBe(initial.uri);
    };
    await select(); await openList(); await step(() => expect(card()).toHaveCount(1)); await step(() => expect(card().locator('pre').first()).not.toContainText('LIST_FULL_TAIL')); await step(() => expect(card().getByLabel(pagesText.connection.replace('{0}', '跨连接保存脚本'), { exact: true })).toHaveValue(prepared.profiles[1].id)); await step(() => expect(card().getByRole('button', { name: insertionText.insert, exact: true })).toBeEnabled()); await step(() => card().getByRole('button', { name: insertionText.insert, exact: true }).click()); await step(() => expect(history()).toBeHidden()); await exact(listInserted); expect((await observe()).uri).toBe(initial.uri); expect(await effects()).toEqual(before); await undoRedo(listInserted);
    // 搜索文字只存在完整SQL尾部；未绑定源不选择“打开连接”也能插入同一原查询。
    await select(); await step(() => page.locator('.app-commandbar').getByRole('button', { name: structureText.entry, exact: true }).click()); const structure = page.getByRole('dialog', { name: structureText.title, exact: true }); await step(() => structure.getByRole('button', { name: structureText.savedQueries, exact: true }).click()); const search = page.getByRole('dialog', { name: searchText.title, exact: true }); await step(() => expect(search).toBeVisible()); await step(() => search.getByLabel(searchText.keyword, { exact: true }).fill('SAVED_INSERT_SQL_ONLY_完整尾部')); await step(() => search.getByRole('button', { name: searchText.start, exact: true }).click()); await step(() => expect(search.getByText('未绑定保存脚本', { exact: true })).toBeVisible()); await step(() => search.getByText('未绑定保存脚本', { exact: true }).click()); await step(() => expect(search.getByLabel(searchText.openConnection, { exact: true })).toHaveValue('')); await step(() => expect(search.getByRole('button', { name: searchText.open, exact: true })).toBeDisabled()); await step(() => expect(search.getByRole('button', { name: insertionText.insert, exact: true })).toBeEnabled()); await step(() => search.getByRole('button', { name: insertionText.insert, exact: true }).click()); await step(() => expect(search).toBeHidden()); await exact(searchInserted); expect(await effects()).toEqual(before); await undoRedo(searchInserted);
    // 只hold真实Main已经读取的原包；Escape先进入收尾，原Promise结束后关闭并保持原模型。
    await select(); const beforeLate = await observe(); await openList(); await step(() => application.evaluate(() => { const state = (globalThis as any).__savedQueryInsertionOffline; state.check(); if (state.held || state.gateNext) throw Error('原保存查询读取门不能重入'); state.gateNext = true; })); await step(() => card().getByRole('button', { name: insertionText.insert, exact: true }).click()); await step(() => expect.poll(async () => (await audit()).held).toBe(true)); await step(() => page.keyboard.press('Escape')); await step(() => expect(history().getByRole('button', { name: zh.common.close, exact: true })).toBeDisabled()); await step(() => application.evaluate(() => { const state = (globalThis as any).__savedQueryInsertionOffline; state.check(); if (!state.held || !state.release) throw Error('原保存查询读取未进入交付门'); state.release(); })); await step(() => expect(history()).toBeHidden()); await step(() => expect.poll(async () => (await audit()).pending).toBe(0)); await exact(original); const afterLate = await observe(); expect({ value: afterLate.value, version: afterLate.version, uri: afterLate.uri }).toEqual({ value: beforeLate.value, version: beforeLate.version, uri: beforeLate.uri }); expect(await effects()).toEqual(before);
    // 迟到原包没有加入Undo栈，原搜索插入仍可一次Redo/Undo。
    await step(() => box.focus()); await step(() => page.keyboard.press(redoKey)); await exact(searchInserted); await step(() => page.keyboard.press('ControlOrMeta+Z')); await exact(original); expect(await effects()).toEqual(before);
    const result = await step(audit); expect(result.reads.map(read => read.id)).toEqual([prepared.list.source.id, prepared.search.source.id, prepared.list.source.id]); expect(result.reads.every(read => read.ok && /^[a-f0-9]{64}$/.test(read.digest))).toBe(true); expect(result.reads[0].digest).toBe(result.reads[2].digest); expect(result.pending).toBe(0); expect(result.held).toBe(false); expect(result.denied).toEqual([]); expect(result.engineStarts).toBe(0); expect(result.calls.every(call => call.ok)).toBe(true); expect(result.calls.filter(call => call.command.startsWith('clipboard.') || call.command.startsWith('query.execute') || call.command.startsWith('query.transaction') || call.command === 'sessions.open' || call.command === 'connections.open')).toEqual([]);
    // 全文搜索正式记录本地搜索任务；只允许此唯一已观测编号，不能把它误当SQL执行或掩去其它任务。
    expect(result.searchTaskIds).toHaveLength(1); const tasks = await step(() => page.evaluate(() => window.dbark.invoke('tasks.list', {}))); expect(tasks).toHaveLength(1); expect(tasks[0]).toMatchObject({ id: result.searchTaskIds[0], kind: 'search.savedQueries', status: 'completed' }); expect(page.mainFrame()).toBe(frame); expect(pageErrors).toEqual([]);
    // restore已经核原请求终态；撤销后仅本次不再读取被删除的观察器。
    await step(() => application.evaluate(() => (globalThis as any).__savedQueryInsertionOffline.restore()), true); armed = false; check(); await confirmOwnedDesktopExit(info); closed = true; check(); expect(originalProcess.exitCode).toBe(0);
    await step(() => info.attach('保存查询两入口离线插入真实Main与Monaco', { body: JSON.stringify({ kind: 'dbark.saved-query-insertion-offline', originalTabId: baseline.activeTabId, tabCount: 1, sourceBindingPreserved: true, absentFileBindingPreserved: true, originalDefaultDatabase: before.context, originalConnection: before.connection, modelUri: initial.uri, crossConnectionListInsert: true, unboundFullTextSearchInsert: true, completeSqlRead: result.reads.map(({ sql: _sql, ...read }) => read), singleUndoRedoEachEntrance: true, lateReadEscapePreservedModelVersion: true, localWrites: result.savedSql.length, completedLocalSearchTask: result.searchTaskIds[0], observedDatabaseRequests: result.denied.length, observedUtilityForks: result.engineStarts, observedMainClipboardCommands: 0, clipboardOperationsByTest: 0, pending: result.pending, observationScope: '正式本地配置准备/reload后安装当前window/frame的Main旁观，至退出前restore', originalProcessExitCode: originalProcess.exitCode, normalOwnedExit: true, restartVerified: false, unverified: ['独立重启恢复', '已有活动事务与已返回实库结果', '实际文件绑定编辑器', '保存源并发修改/删除及其它失效路径（由单元测试另验）', '安装包', 'macOS'] }), contentType: 'application/json' }), true); completed = true;
  } catch (reason) { retainOwnedDesktopResources(info); throw reason; }
});
