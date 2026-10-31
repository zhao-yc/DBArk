import{readFile}from'node:fs/promises';
import{join}from'node:path';
import{createRequire}from'node:module';
import type{Database}from'sql.js';
import type{HistoryEntry}from'../../src/shared/contracts';
import{LocalStore}from'../../src/main/storage';
import{test,expect,page,dataDir,pageErrors,desktop,quitDesktop,launchDesktop}from'./desktop-fixture';
import { historyInsertionZh } from '../../src/renderer/locales/historyInsertion.zh-CN';
import { zh } from '../../src/renderer/locales/zh-CN';

test.use({trace:'off',screenshot:'off',video:'off'});
const runtimeRequire=createRequire(join(process.cwd(),'package.json')),dialog=()=>page.getByRole('dialog',{name:'历史与保存的查询',exact:true});
/** 按读取进度的无障碍名称定位，不能误把选择数量或待应用筛选当成读取结果。 */
const progress=()=>dialog().getByRole('status',{name:'历史读取进度',exact:true});
const entry=(patch:Partial<HistoryEntry>={}):HistoryEntry=>({id:'h',connectionId:'source',sql:'SELECT 9007199254740993',startedAt:'2026-10-15T00:00:00Z',elapsedMs:12,success:true,...patch});
/** 应用真正退出后使用生产存储写夹具，再真实重启；不增加可伪造执行历史的生产IPC。 */
async function seed(write:(store:LocalStore)=>void){await quitDesktop();const store=await LocalStore.open(join(dataDir,'dbark.sqlite'),runtimeRequire.resolve('sql.js/dist/sql-wasm.wasm'),{available:()=>false,encrypt:value=>value,decrypt:value=>value});try{write(store);}finally{store.close();}await launchDesktop();}
/** 从实际工作台入口打开并等待首批终态。 */
async function open(){await (await (await import('./navigation-menu')).navigationMenuItem(page.locator('.navigation-toolbar'), {name:'执行历史',exact:true})).click();await expect(dialog().getByRole('button',{name:'刷新到第一页',exact:true})).toBeEnabled();}
async function search(text:string){await dialog().getByLabel('搜索完整历史SQL或错误',{exact:true}).fill(text);await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), {name:'搜索执行历史',exact:true})).click();await expect(dialog().getByRole('button',{name:'刷新到第一页',exact:true})).toBeEnabled();}
/** 仅持久化不可连接的本地来源元数据，不打开数据库连接。 */
function source(store:LocalStore,id='source'){store.saveConnection({id,name:'离线来源 '+id,group:'',color:'#123456',dialect:'mysql',host:'127.0.0.1',port:1,user:'offline',database:'配置默认库'});}

test('读取进度、选择数量和筛选提示可独立定位且保留各自状态', async () => {
 await seed(store => {
  source(store);
  store.addHistory(entry({ id: 'first', sql: 'SELECT 1 -- 第一条' }));
  store.addHistory(entry({ id: 'second', sql: 'SELECT 2 -- 第二条' }));
 });
 await open();
 const selection = dialog().getByRole('status', { name: '历史选择数量', exact: true });
 const filter = dialog().getByRole('status', { name: '历史筛选状态', exact: true });
 const notice = dialog().getByRole('status', { name: '历史选择提示', exact: true });
 await expect(progress()).toContainText('已检查2条 · 匹配2条 · 读取失败0条');
 await expect(selection).toHaveText('已选择 0 条（跨批次保留，最多 100 条）');
 await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: '全选当前批次', exact: true })).click();
 await expect(selection).toHaveText('已选择 2 条（跨批次保留，最多 100 条）');
 await dialog().getByLabel('搜索完整历史SQL或错误', { exact: true }).fill('第一条');
 await expect(filter).toHaveText('筛选已改变，请重新搜索。');
 await expect(notice).toContainText('原选择已清除');
 await expect(selection).toHaveText('已选择 0 条（跨批次保留，最多 100 条）');
 await expect(progress()).toContainText('已检查2条 · 匹配2条 · 读取失败0条');
 await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: '搜索执行历史', exact: true })).click();
 await expect(progress()).toContainText('已检查2条 · 匹配1条 · 读取失败0条');
 await expect(filter).toHaveCount(0);
 await expect(dialog().locator('.history-card')).toHaveAttribute('data-history-id', 'first');
 expect(await page.evaluate(() => window.dbark.invoke('tasks.list', {}))).toEqual([]);
 expect(await page.evaluate(() => window.dbark.invoke('history.list', {}))).toHaveLength(2);
 expect(pageErrors).toEqual([]);
});

test('58条历史分三批、完整SQL和错误筛选及按需错误全文，最小窗口可真实操作',async({},info)=>{
 test.setTimeout(120000);const originalError='原始错误_'+ '错'.repeat(9000)+'错误全文尾部';await seed(store=>{source(store);for(let i=0;i<58;i++)store.addHistory(entry({id:'h'+String(i).padStart(3,'0'),sql:'SELECT 9007199254740993; -- '+ 'x'.repeat(8000)+(i===0?'SQL完整尾部':'普通尾部'),success:i!==1,error:i===1?originalError:undefined}));});await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1024,680));await open();await expect(dialog().locator('.history-card')).toHaveCount(25);await expect(progress()).toContainText('已检查25条');const all=await dialog().locator('.history-card').evaluateAll(cards=>cards.map(card=>card.getAttribute('data-history-id')));expect(all).toEqual(Array.from({length:25},(_,i)=>'h'+String(57-i).padStart(3,'0')));expect(await dialog().locator('.history-card pre').first().textContent()).toHaveLength(513);
 for(const count of[25,8]){await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), {name:'读取下一批',exact:true})).click();await expect(dialog().getByRole('button',{name:'刷新到第一页',exact:true})).toBeEnabled();await expect(dialog().locator('.history-card')).toHaveCount(count);all.push(...await dialog().locator('.history-card').evaluateAll(cards=>cards.map(card=>card.getAttribute('data-history-id'))));}expect(new Set(all).size).toBe(58);await expect(dialog().getByRole('button',{name:'读取下一批',exact:true})).toBeDisabled();
 await search('SQL完整尾部');await expect(dialog().locator('.history-card')).toHaveCount(0);for(const scanned of[50,58]){await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), {name:'读取下一批',exact:true})).click();await expect(progress()).toContainText('已检查'+scanned+'条');}await expect(dialog().locator('.history-card')).toHaveCount(1);await expect(dialog().locator('.history-card')).toHaveAttribute('data-history-id','h000');
 await dialog().getByLabel('执行结果',{exact:true}).selectOption('failed');await search('错误全文尾部');for(let i=0;i<2;i++){await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), {name:'读取下一批',exact:true})).click();await expect(dialog().getByRole('button',{name:'刷新到第一页',exact:true})).toBeEnabled();}const card=dialog().locator('.history-card');await expect(card).toHaveAttribute('data-history-id','h001');await expect(card).not.toContainText('错误全文尾部');await (await (await import('./navigation-menu')).navigationMenuItem(card, {name:'查看完整错误',exact:true})).click();await expect(card.getByRole('region',{name:'完整历史错误',exact:true}).locator('pre')).toHaveText(originalError);await (await (await import('./navigation-menu')).navigationMenuItem(card, {name:'收起完整错误',exact:true})).click();await expect(card).not.toContainText('错误全文尾部');expect((await page.evaluate(()=>window.dbark.invoke('history.list',{})))).toHaveLength(58);expect(await page.evaluate(()=>window.dbark.invoke('tasks.list',{}))).toEqual([]);expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('history-pages-compact-errors.png')});
});

test('四种历史上下文按来源恢复为新草稿，来源失效明确选择替代且不执行写语句',async({},info)=>{
 test.setTimeout(120000);const sql='UPDATE t SET amount=9007199254740993 -- 只打开不执行';const contexts:Partial<HistoryEntry>[]=[{database:'旧库',databaseContext:{state:'known',database:'实际库'}},{database:'旧库',databaseContext:{state:'known',database:null}},{database:'旧库',databaseContext:{state:'unknown'}},{database:'遗留库'}];await seed(store=>{source(store);source(store,'replacement');contexts.forEach((context,index)=>store.addHistory(entry({id:'context'+index,...context,sql})));store.addHistory(entry({id:'missing',connectionId:'deleted',databaseContext:{state:'known',database:'不能继承的库'},sql:'UPDATE t SET n=777'}));});
 for(let index=0;index<contexts.length;index++){await open();const card=dialog().locator(`[data-history-id="context${index}"]`);await expect(card.getByLabel('打开历史的连接：context'+index,{exact:true})).toHaveValue('source');await (await (await import('./navigation-menu')).navigationMenuItem(card, {name:'在新标签打开',exact:true})).click();await expect(dialog()).toHaveCount(0);const expectedContext=contexts[index].databaseContext,expectedDatabase=expectedContext?expectedContext.state==='known'?expectedContext.database??undefined:undefined:contexts[index].database;await expect.poll(async()=>{const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{})),tab=settings.tabs.find(tab=>tab.id===settings.activeTabId);return{count:settings.tabs.length,connectionId:tab?.connectionId,sql:tab?.sql,database:tab?.database,databaseContext:tab?.databaseContext};}).toEqual({count:index+1,connectionId:'source',sql,database:expectedDatabase,databaseContext:expectedContext});const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{})),tab=settings.tabs.find(tab=>tab.id===settings.activeTabId)!;expect(tab.id).not.toBe('context'+index);const context=contexts[index].databaseContext;expect(tab.databaseContext).toEqual(context);expect(tab.database).toBe(context?context.state==='known'?context.database??undefined:undefined:contexts[index].database);}
 await open();const missing=dialog().locator('[data-history-id="missing"]');await expect(missing.getByRole('button',{name:'在新标签打开',exact:true})).toBeDisabled();await missing.getByLabel('打开历史的连接：missing',{exact:true}).selectOption('replacement');await (await (await import('./navigation-menu')).navigationMenuItem(missing, {name:'在新标签打开',exact:true})).click();await expect(dialog()).toHaveCount(0);await expect(page.locator('.query-tab:visible').getByLabel('当前查询默认库',{exact:true})).toHaveText('默认库待确认');await expect.poll(async()=>{const settings=await page.evaluate(()=>window.dbark.invoke('settings.get',{}));return settings.tabs.find(tab=>tab.id===settings.activeTabId);}).toMatchObject({connectionId:'replacement',databaseContext:{state:'unknown'},sql:'UPDATE t SET n=777'});expect(await page.evaluate(()=>window.dbark.invoke('tasks.list',{}))).toEqual([]);expect((await page.evaluate(()=>window.dbark.invoke('history.list',{})))).toHaveLength(5);expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('history-pages-explicit-source.png')});
});

test('损坏历史有明确失败和停止政策，来源及字段筛选不混入其它记录',async({},info)=>{
 test.setTimeout(90000);await seed(store=>{source(store);source(store,'other');store.addHistory(entry({id:'a',sql:'仅本来源SQL'}));store.addHistory(entry({id:'b',connectionId:'other',success:false,error:'仅错误全文'}));const db=(store as unknown as{db:Database}).db;db.run('INSERT INTO history VALUES(?,?,?,?)',['z','source','{损坏JSON','2026-10-16']);db.run('INSERT INTO history VALUES(?,?,?,?)',['unbound','',JSON.stringify({...entry({id:'unbound',sql:'遗留空来源'}),connectionId:undefined}),'2026-10-15T00:00:00Z']);store.saveSettings(store.settings());});await open();await expect(progress()).toContainText('读取失败1条');const failures=dialog().locator('details').filter({has:page.locator('summary').filter({hasText:/^记录读取失败明细 \(1\)$/})});await failures.locator('summary').click();await expect(failures).toContainText('z：执行历史记录JSON无效');await dialog().getByLabel('损坏记录处理',{exact:true}).selectOption('stop');await search('');await expect(progress()).toContainText('遇到记录错误，已停止');await expect(dialog().getByRole('button',{name:'读取下一批',exact:true})).toBeDisabled();await dialog().getByLabel('损坏记录处理',{exact:true}).selectOption('continue');await dialog().getByLabel('历史来源',{exact:true}).selectOption('connection:other');await search('仅错误全文');await expect(dialog().locator('.history-card')).toHaveAttribute('data-history-id','b');await dialog().getByLabel('错误信息',{exact:true}).uncheck();await search('仅错误全文');await expect(dialog().locator('.history-card')).toHaveCount(0);await dialog().getByLabel('历史来源',{exact:true}).selectOption('unbound');await search('遗留空来源');await expect(dialog().locator('.history-card')).toHaveAttribute('data-history-id','unbound');expect(pageErrors).toEqual([]);await page.screenshot({path:info.outputPath('history-pages-corrupt-explicit.png')});
});

test('历史真实IPC取消、切换、关闭和重启释放资源且筛选条件不写本地配置',async()=>{
 test.setTimeout(120000);await seed(store=>{for(let i=0;i<28;i++)store.addHistory(entry({id:'h'+String(i).padStart(3,'0'),sql:'-- '+ 'x'.repeat(200000)}));});const cancelled=await page.evaluate(async()=>{const taskId=crypto.randomUUID(),pending=window.dbark.invoke('history.page',{taskId,search:'仅内存筛选_不能落盘',fields:['sql'],scope:{kind:'all'},status:'all',onError:'continue'}),cancellation=window.dbark.invoke('query.cancel',{taskId});const result=await pending.then(()=>({cancelled:false,message:''}),error=>({cancelled:true,message:error.message}));await cancellation;return result;});expect(cancelled.cancelled).toBe(true);expect(cancelled.message).toContain('取消');await open();await dialog().getByLabel('搜索完整历史SQL或错误',{exact:true}).fill('窗口筛选_不恢复');await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), {name:'保存的查询',exact:true})).click();await expect(dialog().getByRole('button',{name:'执行历史',exact:true})).toBeVisible();await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), {name:'执行历史',exact:true})).click();await expect(dialog().getByLabel('搜索完整历史SQL或错误',{exact:true})).toHaveValue('');await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), {name:'关闭',exact:true})).click();await expect(dialog()).toHaveCount(0);await quitDesktop();await launchDesktop();expect(await page.evaluate(()=>window.dbark.invoke('tasks.list',{}))).toEqual([]);expect((await page.evaluate(()=>window.dbark.invoke('history.list',{})))).toHaveLength(28);const bytes=await readFile(join(dataDir,'dbark.sqlite'));expect(bytes.includes(Buffer.from('仅内存筛选_不能落盘'))).toBe(false);expect(bytes.includes(Buffer.from('窗口筛选_不恢复'))).toBe(false);expect(pageErrors).toEqual([]);
});

test.describe('合成本地历史插入真实Monaco', () => {
  test('完整历史只替换原选区且单次撤销，关闭后的真实迟到读取不编辑原查询', async () => {
    test.setTimeout(120000);
    const prefix = "-- 外部前缀🚢\n", selected = 'REPLACE_ME', suffix = "\nSELECT '外部后缀' AS 尾;";
    const originalSql = prefix + selected + suffix;
    const historySql = '-- 合成失败记录：仅本地夹具，未执行数据库\nUPDATE synthetic SET amount=900719925474099312345, note=\'$1 ${name}\\n\';\n-- ' + 'x'.repeat(650) + '\n-- 完整历史尾标记';
    // 沿原seed体系先退出App再独占SQLite，不能在Main内存快照存活时另开数据库写入。
    await seed(store => {
      source(store); source(store, 'other');
      store.addHistory(entry({ id: 'synthetic-insert', connectionId: 'other', databaseContext: { state: 'known', database: '历史来源库' }, sql: historySql, success: false, error: '合成离线夹具，未执行数据库，不是执行成功证据' }));
      store.saveQuery({ id: 'insertion-source', name: '历史插入原查询', connectionId: 'source', databaseContext: { state: 'known', database: '原查询库' }, sql: originalSql, updatedAt: '2026-10-15T00:00:00Z' });
    });
    await page.addInitScript(() => { self.MonacoEnvironment = { ...self.MonacoEnvironment, globalAPI: true }; });
    await page.reload(); await expect(page.locator('.app-statusbar')).toBeVisible();
    await open(); await (await (await import('./navigation-menu')).navigationMenuItem(dialog(), { name: '保存的查询', exact: true })).click();
    await (await (await import('./navigation-menu')).navigationMenuItem(dialog().locator('.history-card').filter({ has: page.getByText('历史插入原查询', { exact: true }) }), { name: '在新标签打开', exact: true })).click();
    await expect(dialog()).toHaveCount(0);
    const query = page.locator('.query-tab:visible'), box = query.locator('.monaco-editor').getByRole('textbox');
    await expect(box).toBeVisible(); const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    /** Monaco仅用官方只读API观测；正文和选区由正式打开入口及真实按键产生。 */
    const observe = () => page.evaluate(() => {
      const editors = (window as Window & { monaco?: typeof import('monaco-editor') }).monaco?.editor.getEditors().filter(editor => editor.getContainerDomNode().isConnected && editor.getContainerDomNode().closest('.query-tab') && editor.getContainerDomNode().getClientRects().length > 0);
      if (editors?.length !== 1) throw Error('历史插入原查询编辑器不唯一'); const model = editors[0].getModel(); if (!model || model.isDisposed()) throw Error('历史插入原模型未知');
      return { value: model.getValue(), version: model.getVersionId(), eol: model.getEOL(), uri: model.uri.toString(), ranges: editors[0].getSelections()?.map(range => ({ start: model.getOffsetAt(range.getStartPosition()), end: model.getOffsetAt(range.getEndPosition()) })) };
    });
    const initial = await observe(), normalize = (text: string) => text.replaceAll('\n', initial.eol);
    expect(initial.value).toBe(normalize(originalSql));
    /** 同时核对真实模型及正常settings保存路径，不能仅观察store冒充编辑器撤销。 */
    const exact = async (value: string) => {
      await expect.poll(async () => (await observe()).value).toBe(value);
      await expect.poll(async () => { const settings = await page.evaluate(() => window.dbark.invoke('settings.get', {})); return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql; }).toBe(value);
    };
    await box.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'); await page.keyboard.press('Space');
    const original = normalize(originalSql) + ' ', inserted = normalize(prefix + historySql + suffix) + ' '; await exact(original);
    /** 选择ASCII哨兵而保留外部Unicode/EOL；不用setSelection或executeEdits预置测试答案。 */
    const select = async () => {
      await box.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home'); await page.keyboard.press('ArrowDown');
      for (const _character of selected) await page.keyboard.press('Shift+ArrowRight');
      expect((await observe()).ranges).toEqual([{ start: normalize(prefix).length, end: normalize(prefix).length + selected.length }]);
    };
    /** 离线证据仅证明原无结果/未连接事务状态不变，不能推导真实活动事务保持。 */
    const sideEffects = async () => {
      const stored = await page.evaluate(async () => { const settings = await window.dbark.invoke('settings.get', {}); return { activeTabId: settings.activeTabId, tabs: settings.tabs.map(({ sql: _sql, ...tab }) => tab), tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}), queries: await window.dbark.invoke('queries.list', {}) }; });
      return { ...stored, context: await query.getByLabel('当前查询默认库', { exact: true }).textContent(), connection: await query.locator('.query-context-target > strong').textContent(), session: await query.locator('.context-bar').getByText(zh.query.text009, { exact: true }).textContent(), result: await query.locator('.result-body').textContent(), grids: await query.locator('.result-body [role="grid"]').count(), commitDisabled: await query.getByRole('button', { name: zh.common.transactionCommit, exact: true }).isDisabled(), rollbackDisabled: await query.getByRole('button', { name: zh.common.transactionRollback, exact: true }).isDisabled() };
    };
    const before = await sideEffects(); expect(before.tabs).toHaveLength(1); expect(before.grids).toBe(0); expect(before.session).toBe(zh.query.text009); expect(before.commitDisabled).toBe(true); expect(before.rollbackDisabled).toBe(true); expect(before.context).toBe('原查询库'); expect(before.tasks).toEqual([]);
    await desktop.evaluate(({ ipcMain, BrowserWindow }) => {
      const root = globalThis as any, handlers = (ipcMain as any)._invokeHandlers, previous = handlers?.get('dbark:request'), window = BrowserWindow.getAllWindows()[0], frame = window.webContents.mainFrame;
      if (!previous || root.__historyInsertionAudit || BrowserWindow.getAllWindows().length !== 1) throw Error('历史插入Main旁观归属未知');
      const state = { pending: 0, calls: [] as string[], reads: [] as { id: string; digest: string; connectionId: string; ok: boolean }[], gateNext: false, held: false, release: undefined as (() => void) | undefined, check() {}, restore() {} };
      const check = () => { if (root.__historyInsertionAudit !== state || handlers.get('dbark:request') !== wrapped || window.isDestroyed() || window.webContents.mainFrame !== frame || BrowserWindow.getAllWindows().length !== 1) throw Error('历史插入Main原归属变化'); };
      const wrapped = async (event: any, payload: any) => {
        check(); if (event.sender !== window.webContents || event.senderFrame !== frame) throw Error('历史插入Main原IPC来源变化'); state.calls.push(String(payload.command)); state.pending++;
        try {
          const result = await previous(event, payload); check();
          if (payload.command === 'history.read') {
            state.reads.push({ id: payload.input.id, digest: payload.input.digest, connectionId: payload.input.connectionId, ok: result?.ok === true });
            // 先取得真实原处理结果，只延后本次交付；不替换SQL、摘要、成功状态或数据库执行结果。
            if (state.gateNext) { state.gateNext = false; state.held = true; await new Promise<void>(resolve => { state.release = () => { if (!state.held) throw Error('原历史读取门已经释放'); state.held = false; state.release = undefined; resolve(); }; }); check(); }
          }
          return result;
        } finally { state.pending--; }
      };
      state.check = check; state.restore = () => { check(); if (state.pending || state.held) throw Error('原历史读取尚未收尾'); handlers.set('dbark:request', previous); delete root.__historyInsertionAudit; };
      root.__historyInsertionAudit = state; handlers.set('dbark:request', wrapped);
    });
    const audit = () => desktop.evaluate(() => { const state = (globalThis as any).__historyInsertionAudit; state.check(); return { pending: state.pending as number, held: state.held as boolean, calls: state.calls as string[], reads: state.reads as { id: string; digest: string; connectionId: string; ok: boolean }[] }; });
    let failure: unknown, failed = false;
    try {
      await select(); await open(); const card = dialog().locator('[data-history-id="synthetic-insert"]');
      await expect(card.locator('pre').first()).not.toContainText('完整历史尾标记'); await expect(card.getByLabel('打开历史的连接：synthetic-insert', { exact: true })).toHaveValue('other');
      await expect(card.getByRole('button', { name: historyInsertionZh.insert, exact: true })).toBeEnabled(); await (await (await import('./navigation-menu')).navigationMenuItem(card, { name: historyInsertionZh.insert, exact: true })).click(); await expect(dialog()).toHaveCount(0); await exact(inserted);
      expect((await observe()).uri).toBe(initial.uri); expect(await sideEffects()).toEqual(before);
      await box.focus(); await page.keyboard.press(`${modifier}+z`); await exact(original); expect(await sideEffects()).toEqual(before);
      await select(); const beforeLate = await observe(); await open();
      await desktop.evaluate(() => { const state = (globalThis as any).__historyInsertionAudit; state.check(); if (state.held || state.gateNext) throw Error('历史原读取门不能重入'); state.gateNext = true; });
      await (await (await import('./navigation-menu')).navigationMenuItem(dialog().locator('[data-history-id="synthetic-insert"]'), { name: historyInsertionZh.insert, exact: true })).click(); await expect.poll(async () => (await audit()).held).toBe(true);
      await page.keyboard.press('Escape'); await expect(dialog().getByRole('button', { name: zh.common.close, exact: true })).toBeDisabled();
      await desktop.evaluate(() => { const state = (globalThis as any).__historyInsertionAudit; state.check(); if (!state.held || !state.release) throw Error('原历史读取尚未进入交付门'); state.release(); });
      await expect(dialog()).toHaveCount(0); await expect.poll(async () => (await audit()).pending).toBe(0); await exact(original);
      const afterLate = await observe(); expect({ value: afterLate.value, version: afterLate.version, uri: afterLate.uri }).toEqual({ value: beforeLate.value, version: beforeLate.version, uri: beforeLate.uri }); expect(await sideEffects()).toEqual(before);
      // 迟到读取未创建新编辑，原插入的Redo/Undo分组仍各只需一次真实按键。
      await box.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y'); await exact(inserted); await page.keyboard.press(`${modifier}+z`); await exact(original);
      const result = await audit(); expect(result.reads).toHaveLength(2); expect(result.reads.map(({ digest: _digest, ...read }) => read)).toEqual(Array.from({ length: 2 }, () => ({ id: 'synthetic-insert', connectionId: 'source', ok: true }))); expect(result.reads.every(read => /^[a-f0-9]{64}$/.test(read.digest))).toBe(true); expect(result.reads[0].digest).toBe(result.reads[1].digest);
      expect(result.calls.filter(command => command.startsWith('query.execute') || command.startsWith('query.transaction') || command === 'sessions.open')).toEqual([]); expect(await sideEffects()).toEqual(before); expect(pageErrors).toEqual([]);
    } catch (reason) { failed = true; failure = reason; throw reason; }
    finally {
      // 只释放本例人为延迟的原回包，原错误和原退出门保留；不让测试门污染默认fixture退出。
      try { await desktop.evaluate(() => { const state = (globalThis as any).__historyInsertionAudit; state.check(); if (state.held) state.release(); }); await expect.poll(async () => (await audit()).pending).toBe(0); await desktop.evaluate(() => { (globalThis as any).__historyInsertionAudit.restore(); }); }
      catch (cleanup) { if (failed) throw new AggregateError([failure, cleanup], '历史插入原用例失败且旁观门收尾未确认', { cause: failure }); throw cleanup; }
    }
  });
});
