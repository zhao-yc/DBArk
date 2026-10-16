import { test, expect, page, pageErrors } from './desktop-fixture';
import type { TestInfo } from '@playwright/test';
import type { RowDataPacket } from 'mysql2/promise';

const enabled = process.env.DBARK_INTEGRATION_ENABLED === '1' && process.env.DBARK_Q01_WINDOW_INHERITANCE_UI === '1';
test.skip(!enabled, '需要统筹同时授权实库与Q01继承窗口专用原生验收');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.describe.configure({ timeout: 150000 });

interface AcceptedCase { group: 'direct' | 'chain' | 'complete' | 'isolation'; marked: string; expected: string; }
interface BlockedCase { group: 'invalid' | 'complete' | 'isolation'; marked: string; }

// 期望全文独立声明，必须同时覆盖替换前缀、右侧suffix以及引用符号。
const acceptedCases: AcceptedCase[] = [
  { group: 'direct', marked: 'SELECT SUM(s.id) OVER(base ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW base AS(PARTITION BY s.id)', expected: 'SELECT SUM(s.id) OVER(base ORDER BY s.`inherit_value`) FROM q01_window_subject s WINDOW base AS(PARTITION BY s.id)' },
  { group: 'direct', marked: 'SELECT SUM(s.id) OVER(base ORDER BY inherit_va|suffix) FROM q01_window_subject s WINDOW base AS()', expected: 'SELECT SUM(s.id) OVER(base ORDER BY `s`.`inherit_value`) FROM q01_window_subject s WINDOW base AS()' },
  { group: 'chain', marked: 'SELECT SUM(s.id) OVER(w2 ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW w0 AS(PARTITION BY s.id),w1 AS(w0),w2 AS(w1)', expected: 'SELECT SUM(s.id) OVER(w2 ORDER BY s.`inherit_value`) FROM q01_window_subject s WINDOW w0 AS(PARTITION BY s.id),w1 AS(w0),w2 AS(w1)' },
  { group: 'chain', marked: 'SELECT SUM(s.id) OVER child FROM q01_window_subject s WINDOW base AS(PARTITION BY s.id),child AS(base ORDER BY s.inherit_va|suffix)', expected: 'SELECT SUM(s.id) OVER child FROM q01_window_subject s WINDOW base AS(PARTITION BY s.id),child AS(base ORDER BY s.`inherit_value`)' },
  { group: 'complete', marked: 'SELECT SUM(s.id) OVER(base ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW base AS(PARTITION BY COALESCE(s.id,0)),other AS(base)', expected: 'SELECT SUM(s.id) OVER(base ORDER BY s.`inherit_value`) FROM q01_window_subject s WINDOW base AS(PARTITION BY COALESCE(s.id,0)),other AS(base)' },
  { group: 'isolation', marked: 'SELECT * FROM q01_window_subject s JOIN (SELECT SUM(o.id) OVER(base ORDER BY o.inherit_va|suffix) FROM q01_window_subject o WINDOW base AS(PARTITION BY o.id))d WINDOW base AS(ORDER BY s.id)', expected: 'SELECT * FROM q01_window_subject s JOIN (SELECT SUM(o.id) OVER(base ORDER BY o.`inherit_value`) FROM q01_window_subject o WINDOW base AS(PARTITION BY o.id))d WINDOW base AS(ORDER BY s.id)' },
];
const blockedCases: BlockedCase[] = [
  { group: 'invalid', marked: 'SELECT SUM(s.id) OVER(base ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW base AS(unknown)' },
  { group: 'invalid', marked: 'SELECT SUM(s.id) OVER(base ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW base AS(base)' },
  { group: 'invalid', marked: 'SELECT SUM(s.id) OVER(base ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW base AS(next),next AS(base)' },
  { group: 'invalid', marked: 'SELECT SUM(s.id) OVER(base ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW base AS(next),next AS()' },
  { group: 'complete', marked: 'SELECT SUM(s.id) OVER(base ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW base AS(),' },
  { group: 'complete', marked: 'SELECT SUM(s.id) OVER(base ORDER BY s.inherit_va|suffix) FROM q01_window_subject s WINDOW base AS(PARTITION BY COALESCE(s.id,))' },
  { group: 'isolation', marked: 'SELECT 1 FROM q01_window_subject s WINDOW base AS() UNION ALL SELECT SUM(o.id) OVER(base ORDER BY o.inherit_va|suffix) FROM q01_window_subject o' },
  { group: 'isolation', marked: 'SELECT (SELECT SUM(o.id) OVER(base ORDER BY o.inherit_va|suffix) FROM q01_window_subject o) FROM q01_window_subject s WINDOW base AS()' },
  { group: 'isolation', marked: 'WITH q AS(SELECT SUM(o.id) OVER(base ORDER BY o.inherit_va|suffix) FROM q01_window_subject o) SELECT * FROM q WINDOW base AS()' },
  { group: 'isolation', marked: 'SELECT (SELECT SUM(o.id) OVER(base ORDER BY o.inherit_va|suffix) FROM q01_window_subject o WINDOW base AS(ORDER BY o.id)) FROM q01_window_subject s WINDOW base AS()' },
];

type Caret = typeof import('./monaco-caret');
interface Reply { generation: number; status: string; reason?: string; }
interface WorkerAudit { generation: number; expected?: { source: string; offset: number }; keySeen: boolean; replies: Reply[]; }
type AuditWindow = Window & { __q01InheritanceWorker?: WorkerAudit };

/** 只旁观真实Worker消息；原构造器、入参、转移列表和响应均原样传递。 */
async function observeWorker(): Promise<void> {
  await page.addInitScript(() => {
    const root = window as AuditWindow;
    const audit: WorkerAudit = { generation: 0, keySeen: false, replies: [] };
    root.__q01InheritanceWorker = audit;
    const pending = new WeakMap<Worker, Map<number, number>>(), nativePost = Worker.prototype.postMessage;
    document.addEventListener('keydown', event => {
      if (audit.expected && event.isTrusted && !event.repeat && event.code === 'Space' && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) audit.keySeen = true;
    }, true);
    Worker.prototype.postMessage = function(this: Worker, value: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      let requests = pending.get(this);
      if (!requests) {
        requests = new Map(); pending.set(this, requests);
        this.addEventListener('message', event => {
          const response = event.data as { id?: number; result?: { status?: string; reason?: string } };
          const generation = response.id === undefined ? undefined : requests!.get(response.id);
          if (generation === undefined || typeof response.result?.status !== 'string') return;
          requests!.delete(response.id!);
          if (generation !== audit.generation) return;
          audit.replies.push({ generation, status: response.result.status, reason: response.result.reason });
          if (audit.replies.length > 32) audit.replies.shift();
        });
      }
      const request = value as { id?: number; source?: string; offset?: number } | null;
      if (audit.keySeen && audit.expected && Number.isInteger(request?.id) && request?.source === audit.expected.source && request.offset === audit.expected.offset) {
        if (requests.size >= 32) requests.delete(requests.keys().next().value!);
        requests.set(request.id!, audit.generation);
      }
      return Reflect.apply(nativePost, this, options === undefined ? [value] : [value, options]);
    };
  });
}

/** 仅保存同次触发的布尔/状态证据，旧请求或别的正文不能满足当前断言。 */
async function trigger(caret: Caret, marked: string, status: 'ready' | 'blocked'): Promise<void> {
  const source = marked.replace('|', ''), offset = marked.indexOf('|');
  await page.evaluate(expected => {
    const audit = (window as AuditWindow).__q01InheritanceWorker;
    if (!audit) throw Error('缺少只读Worker观察器');
    audit.generation++; audit.expected = expected; audit.keySeen = false; audit.replies = [];
  }, { source, offset });
  await caret.triggerMonacoCompletion(marked);
  await expect.poll(() => page.evaluate(status => {
    const audit = (window as AuditWindow).__q01InheritanceWorker;
    return !!audit?.keySeen && audit.replies.some(reply => reply.generation === audit.generation && reply.status === status && (status !== 'blocked' || reply.reason === 'syntax'));
  }, status), { timeout: caret.remainingCompletionTimeout(), message: '等待真实按键后同正文/光标的真实Worker结果' }).toBe(true);
}

/** 从持久草稿读取完整正文，不用编辑器模型setter或视口文字充当最终结果。 */
async function expectSql(caret: Caret, source: string): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const settings = await window.dbark.invoke('settings.get', {});
    return settings.tabs.find(tab => tab.id === settings.activeTabId)?.sql?.replaceAll('\r\n', '\n');
  }), { timeout: caret.remainingCompletionTimeout(5000) }).toBe(source);
}

/** 元数据补全不得执行被编辑的SQL或新增查询历史、普通任务。 */
async function records() {
  return page.evaluate(async () => ({ tasks: await window.dbark.invoke('tasks.list', {}), history: await window.dbark.invoke('history.list', {}) }));
}

/** 正向必须经真实候选、Enter及原生撤销；右侧suffix也须完整替换。 */
async function acceptAndUndo(caret: Caret, item: AcceptedCase): Promise<void> {
  const before = await records();
  await caret.positionMonacoCaret(item.marked);
  await trigger(caret, item.marked, 'ready');
  const widget = page.locator('.suggest-widget.visible');
  await expect(widget.locator('.monaco-list-row.focused')).toContainText('inherit_value', { timeout: caret.remainingCompletionTimeout() });
  await page.keyboard.press('Enter');
  await expect(widget).toHaveCount(0, { timeout: caret.remainingCompletionTimeout(5000) });
  await expectSql(caret, item.expected);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expectSql(caret, item.marked.replace('|', ''));
  expect(await records()).toEqual(before);
}

/** 负向须由真实Worker明确syntax阻断，不能仅因面板偶然为空而通过。 */
async function rejectCompletion(caret: Caret, item: BlockedCase): Promise<void> {
  const before = await records();
  await caret.positionMonacoCaret(item.marked);
  await trigger(caret, item.marked, 'blocked');
  await expect(page.locator('.suggest-widget.visible .monaco-list-row')).toHaveCount(0, { timeout: caret.remainingCompletionTimeout(5000) });
  await expectSql(caret, item.marked.replace('|', ''));
  expect(await records()).toEqual(before);
}

/** 私网帮助器仅在执行体加载；复用原隔离库清理，同时禁止其失败分支显式截图。 */
async function withPhysicalSource(body: (caret: Caret) => Promise<void>, info: TestInfo) {
  const caret = await import('./monaco-caret');
  const live = await import('./live-helpers');
  await observeWorker();
  await caret.observeMonacoCaret();
  const screenshot = page.screenshot;
  page.screenshot = async () => { throw Error('Q01继承窗口专用验收禁止截图'); };
  try {
    await live.isolatedDatabase(async ({ observer, database }) => {
      const [versions] = await observer.query<RowDataPacket[]>('SELECT VERSION() AS version');
      const version = String(versions[0]?.version ?? ''), maria = /MariaDB/i.test(version);
      const parts = (maria ? version.replace(/^5\.5\.5-/, '') : version).match(/^(\d+)\.(\d+)/);
      test.skip(!parts || !(maria ? Number(parts[1]) > 10 || Number(parts[1]) === 10 && Number(parts[2]) >= 2 : Number(parts[1]) >= 8), '实际服务器不支持窗口切片；MySQL5.7及未知版本不计通过');
      await observer.query(`CREATE TABLE \`${database}\`.q01_window_subject(id INT PRIMARY KEY,inherit_value INT,other_value INT)`);
      await live.openDatabaseQuery(database);
      // 用真实会话建立基准；后续所有继承样例只补全，不执行其正文。
      await live.executeSql('SELECT 1');
      const query = page.locator('.query-tab:visible');
      await query.getByRole('button', { name: '会话临时对象', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '当前查询会话的临时对象', exact: true });
      await modal.getByLabel('数据库名称', { exact: true }).fill(database);
      await modal.getByLabel('表或视图名称', { exact: true }).fill('q01_window_subject');
      await modal.getByRole('button', { name: '读取会话结构', exact: true }).click();
      await expect(modal.locator('.success-box')).toContainText('该名称当前不是临时表', { timeout: 20000 });
      await modal.getByRole('button', { name: '关闭', exact: true }).click();
      await body(caret);
      expect(pageErrors).toEqual([]);
    }, info);
  } finally { page.screenshot = screenshot; }
}

test('Q01继承ORDER：真实物理字段完整接受与撤销，限定和非限定范围均保留', async ({ trace, screenshot, video }, info) => {
  expect({ trace, screenshot, video }).toEqual({ trace: 'off', screenshot: 'off', video: 'off' });
  await withPhysicalSource(async caret => { for (const item of acceptedCases.filter(item => item.group === 'direct')) await acceptAndUndo(caret, item); }, info);
});

test('Q01多级继承：空分区链与命名child定义均使用本块真实目录', async ({ trace, screenshot, video }, info) => {
  expect({ trace, screenshot, video }).toEqual({ trace: 'off', screenshot: 'off', video: 'off' });
  await withPhysicalSource(async caret => { for (const item of acceptedCases.filter(item => item.group === 'chain')) await acceptAndUndo(caret, item); }, info);
});

test('Q01非法继承：未知、自循环、相互循环与无环前向引用均由真实Worker阻断', async ({ trace, screenshot, video }, info) => {
  expect({ trace, screenshot, video }).toEqual({ trace: 'off', screenshot: 'off', video: 'off' });
  await withPhysicalSource(async caret => { for (const item of blockedCases.filter(item => item.group === 'invalid')) await rejectCompletion(caret, item); }, info);
});

test('Q01完整性：尾逗号和PARTITION缺参拒绝，完整表达式仍可接受撤销', async ({ trace, screenshot, video }, info) => {
  expect({ trace, screenshot, video }).toEqual({ trace: 'off', screenshot: 'off', video: 'off' });
  await withPhysicalSource(async caret => {
    for (const item of blockedCases.filter(item => item.group === 'complete')) await rejectCompletion(caret, item);
    for (const item of acceptedCases.filter(item => item.group === 'complete')) await acceptAndUndo(caret, item);
  }, info);
});

test('Q01查询块隔离：UNION祖先与CTE外部不借名，内层定义独立遮蔽', async ({ trace, screenshot, video }, info) => {
  expect({ trace, screenshot, video }).toEqual({ trace: 'off', screenshot: 'off', video: 'off' });
  await withPhysicalSource(async caret => {
    for (const item of blockedCases.filter(item => item.group === 'isolation')) await rejectCompletion(caret, item);
    for (const item of acceptedCases.filter(item => item.group === 'isolation')) await acceptAndUndo(caret, item);
  }, info);
});
