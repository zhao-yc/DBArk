import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, renameSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import initSqlJs from 'sql.js';
import { LocalStore, defaultSettings } from '../../src/main/storage';
import { QueryFileSources, type QueryFileSourceScope } from '../../src/main/queryFileSources';
import { queryFileSqlDigest, encodeBoundQueryFile, queryFileEol, readQueryFileSnapshot, writeBoundQueryFile } from '../../src/main/queryFileSourceFiles';
import type { TaskEvent } from '../../src/shared/contracts';
import { validateCommand } from '../../src/shared/validation';
import type { QueryFileSourceOpenResult, QueryFileSourceSaveResult, QueryFileSourceView } from '../../src/shared/queryFileSources';
import { ExportReservations } from '../../src/main/exportReservations';
import { privateQueryFileSourceSchema } from '../../src/main/queryFileSourceRecords';

const root = resolve('.cache/sql-file-binding-tests'), wasm = createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm');
const protector = { available: () => false, encrypt: () => { throw Error('本例不使用凭据'); }, decrypt: () => { throw Error('本例不得读取凭据'); } };
const stores = new Set<LocalStore>(), directories: string[] = [];
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
beforeAll(async () => { mkdirSync(root, { recursive: true }); SQL = await initSqlJs({ locateFile: () => wasm }); });
/** 只清理本例亲自创建、且已核对父目录的合成文件夹。 */
afterEach(() => {
  for (const store of stores) store.close(); stores.clear();
  for (const directory of directories.splice(0)) { if (dirname(directory) !== root) throw Error('测试清理越界'); rmSync(directory, { recursive: true, force: true }); }
});
/** 使用本clone专属临时文件和本地配置SQL.js，不连接服务器或真实用户文件。 */
async function fixture(bytes = Buffer.from('select 1;\n'), tabIds = ['one']) {
  const directory = mkdtempSync(join(root, 'case-')); directories.push(directory);
  const path = join(directory, '脚本.sql'), database = join(directory, 'config.sqlite'); writeFileSync(path, bytes);
  const store = await LocalStore.open(database, wasm, protector); stores.add(store);
  store.saveSettings({ ...defaultSettings, tabs: tabIds.map(id => ({ id, kind: 'query', title: '查询', connectionId: 'ram', sql: '' })) });
  let choice: string | undefined = path, available = true;
  const reservations = new ExportReservations();
  const events: TaskEvent[] = [];
  const host = { store, report: (event: TaskEvent) => { events.push(event); }, choose: async () => choice, reserve: (target: string) => reservations.acquire(target) };
  const service = new QueryFileSources(host), scope: QueryFileSourceScope = { document: {}, assertCurrent: () => { if (!available) throw Error('文档已失效'); } };
  return { directory, path, database, store, service, scope, host, events, choose: (value: string | undefined) => { choice = value; }, invalidate: () => { available = false; } };
}
/** 对判别联合收窄，失败时保留实际typed状态供定位。 */
function opened(result: QueryFileSourceOpenResult): QueryFileSourceView { expect(result.state).toBe('opened'); if (result.state !== 'opened') throw Error(JSON.stringify(result)); return result.binding; }
function saved(result: QueryFileSourceSaveResult): QueryFileSourceView { expect(result.state).toBe('saved'); if (result.state !== 'saved') throw Error(JSON.stringify(result)); return result.binding; }

describe('SQL文件来源后台完整路径', () => {
  it('无编辑按保存仍先核磁盘：外改删除替换及双tab先存后另一tab原样保存均拒绝', async () => {
    const original = 'select 1;\n';
    for (const action of ['change', 'delete', 'replace']) {
      const f = await fixture(), binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
      if (action === 'delete') rmSync(f.path); else if (action === 'replace') { renameSync(f.path, f.path + '.old'); writeFileSync(f.path, original); } else writeFileSync(f.path, '外改');
      expect(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: original }, f.scope)).toMatchObject({ state: 'blocked', wrote: 'no', reason: action === 'change' ? 'external-change' : action === 'delete' ? 'missing' : 'identity-changed' });
    }
    const f = await fixture(undefined, ['one', 'two']), first = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope)), second = opened(await f.service.open({ taskId: randomUUID(), tabId: 'two', encoding: 'utf8' }, f.scope));
    saved(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: first.ref, sql: 'A已经保存' }, f.scope));
    expect(await f.service.save({ taskId: randomUUID(), tabId: 'two', source: second.ref, sql: original }, f.scope)).toMatchObject({ state: 'blocked', wrote: 'no' });
    expect(readFileSync(f.path, 'utf8')).toBe('A已经保存');
  });
  it('主来源互斥经过原始IPC与直接store，打开原子切换，解除须release再删除字段', async () => {
    const f = await fixture(), local = { id: 'local', digest: '0'.repeat(64), context: { state: 'unknown' as const } };
    f.store.saveSettings({ ...f.store.settings(), tabs: [{ ...f.store.settings().tabs[0], sourceBinding: local }] });
    const binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
    expect(f.store.settings().tabs[0].sourceBinding).toBeUndefined();
    const both = { ...f.store.settings(), tabs: [{ ...f.store.settings().tabs[0], sourceBinding: local }] };
    expect(() => validateCommand('settings.save', both)).toThrow('主来源'); expect(() => f.store.saveSettings(both)).toThrow('主来源');
    expect(await f.service.release({ tabId: 'one', source: binding.ref }, f.scope)).toEqual({ released: true });
    const { fileSourceBinding: _released, ...plain } = f.store.settings().tabs[0];
    f.store.saveSettings({ ...f.store.settings(), tabs: [{ ...plain, sourceBinding: local }] });
    expect(f.store.settings().tabs[0].sourceBinding).toEqual(local); expect(f.store.settings().tabs[0].fileSourceBinding).toBeUndefined();
    expect(() => f.store.saveSettings({ ...f.store.settings(), tabs: [{ ...plain, fileSourceBinding: undefined }] })).toThrow('不透明引用');
  });
  it('读取及暂存分块进度可精确取消，错误tab或文档不能取消，收尾后才发terminal', async () => {
    for (const phase of ['reading', 'staging']) {
      const bytes = Buffer.from('x'.repeat(140_000)), f = await fixture(bytes), binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
      const taskId = randomUUID(), originalReport = f.host.report; let cancel: Promise<{ cancelled: boolean }> | undefined; const rejected: Promise<{ cancelled: boolean }>[] = [];
      f.host.report = event => {
        originalReport(event);
        if (event.taskId !== taskId || event.queryFileSource?.phase !== phase || !event.queryFileSource.bytesProcessed || cancel) return;
        // 同一同步回调只发撤销意图，不等待自己所观察的在途任务。
        rejected.push(f.service.cancel({ tabId: 'other', taskId }, f.scope), f.service.cancel({ tabId: 'one', taskId }, { ...f.scope, document: {} }));
        cancel = f.service.cancel({ tabId: 'one', taskId }, f.scope);
      };
      const result = await f.service.save({ taskId, tabId: 'one', source: binding.ref, sql: 'y'.repeat(140_000) }, f.scope);
      expect(result).toMatchObject({ state: 'blocked', wrote: 'no' }); expect(await cancel).toEqual({ cancelled: true }); expect(readFileSync(f.path)).toEqual(bytes);
      expect(await Promise.all(rejected)).toEqual([{ cancelled: false }, { cancelled: false }]);
      expect(f.events.find(event => event.taskId === taskId && event.queryFileSource?.phase === phase && event.queryFileSource.bytesProcessed > 0)?.queryFileSource?.cancellable).toBe(true);
      expect(f.events.filter(event => event.taskId === taskId).at(-1)).toMatchObject({ status: 'cancelled', queryFileSource: { phase: 'terminal', cancellable: false, wrote: 'no' } });
      expect(readdirSync(f.directory).some(name => name.includes('.dbark-'))).toBe(false);
    }
  });
  it('进入rename提交点后显式cancel拒绝，任务报告已写并完成，不能伪称取消成功', async () => {
    const f = await fixture(), binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope)), taskId = randomUUID();
    let cancel: Promise<{ cancelled: boolean }> | undefined, cancelState = ''; const report = f.host.report;
    f.host.report = event => { report(event); if (event.taskId === taskId && event.queryFileSource?.phase === 'replacing') { cancelState = f.service.cancelState(taskId); cancel = f.service.cancel({ tabId: 'one', taskId }, f.scope); } };
    saved(await f.service.save({ taskId, tabId: 'one', source: binding.ref, sql: '确认写入' }, f.scope));
    expect(await cancel).toEqual({ cancelled: false }); expect(readFileSync(f.path, 'utf8')).toBe('确认写入');
    expect(cancelState).toBe('confirming'); expect(f.service.cancelState(taskId)).toBe('finished');
    expect(f.events.find(event => event.taskId === taskId && event.queryFileSource?.phase === 'replacing')?.queryFileSource?.cancellable).toBe(false);
    expect(f.events.filter(event => event.taskId === taskId).at(-1)).toMatchObject({ status: 'completed', queryFileSource: { wrote: 'yes', phase: 'terminal' } });
  });
  it('直接关闭tab也撤销在途授权，终态为取消且原文件保持，不借同ID默认回退', async () => {
    const f = await fixture(), taskId = randomUUID();
    f.host.choose = async () => { f.store.saveSettings({ ...f.store.settings(), tabs: [] }); return f.path; };
    expect(await f.service.open({ taskId, tabId: 'one', encoding: 'utf8' }, f.scope)).toMatchObject({ state: 'blocked', reason: 'document-changed', wrote: 'no' });
    expect(f.events.at(-1)).toMatchObject({ taskId, status: 'cancelled', queryFileSource: { phase: 'terminal', wrote: 'no' } });
    expect(f.store.queryFileSource('one')).toBeUndefined(); expect(readFileSync(f.path, 'utf8')).toBe('select 1;\n');
  });
  it('打开授权与settings引用原子保存，重启status不访问外部文件且显式保存可用', async () => {
    const f = await fixture(); const binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
    expect(f.store.settings().tabs[0].sql).toBe('select 1;\n');
    expect(f.store.settings().tabs[0].fileSourceBinding).toEqual(binding.ref);
    expect(JSON.stringify(f.store.settings())).not.toContain(f.path);
    expect(privateQueryFileSourceSchema.safeParse({ ...f.store.queryFileSource('one'), path: '相对路径.sql' }).success).toBe(false);
    f.store.close(); stores.delete(f.store);
    const store = await LocalStore.open(f.database, wasm, protector); stores.add(store);
    const reservations = new ExportReservations(); let choices = 0;
    const service = new QueryFileSources({ store, report: () => undefined, choose: async () => { choices++; throw Error('status和save不应弹文件框'); }, reserve: path => reservations.acquire(path) });
    expect(service.status({ tabId: 'one' }, f.scope)).toEqual({ state: 'bound', binding });
    const next = saved(await service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: 'select 2;\n' }, f.scope));
    expect(next.ref.revision).toBe(2); expect(choices).toBe(0); expect(readFileSync(f.path, 'utf8')).toBe('select 2;\n');
    renameSync(f.path, f.path + '.parked');
    expect(service.status({ tabId: 'one' }, f.scope)).toEqual({ state: 'bound', binding: next });
  });
  it('UTF8 BOM和CRLF保持，保存只推进快照基线，不回填较新的查询输入', async () => {
    const f = await fixture(Buffer.from('\uFEFFselect 1;\r\n'));
    const binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'gb18030' }, f.scope));
    expect(binding).toMatchObject({ encoding: 'utf8', bom: 'utf8', eol: 'crlf' });
    f.store.saveSettings({ ...f.store.settings(), tabs: f.store.settings().tabs.map(tab => ({ ...tab, sql: '保存期间的新正文' })) });
    const next = saved(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: 'select 2;\n' }, f.scope));
    expect(readFileSync(f.path)).toEqual(Buffer.from('\uFEFFselect 2;\r\n'));
    expect(next.savedSqlDigest).toBe(queryFileSqlDigest('select 2;\n'));
    expect(f.store.settings().tabs[0].sql).toBe('保存期间的新正文');
    const late = { ...f.store.settings(), tabs: [{ ...f.store.settings().tabs[0], fileSourceBinding: binding.ref }] };
    f.store.saveSettings(late); expect(f.store.settings().tabs[0].fileSourceBinding).toEqual(next.ref);
    expect(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '过期' }, f.scope)).toMatchObject({ state: 'blocked', wrote: 'no', reason: 'stale-source' });
  });
  it('混合换行无编辑保原字节，有编辑须显式选择且拒绝时无临时残留', async () => {
    const bytes = Buffer.from('a\r\nb\nc\r'), f = await fixture(bytes);
    const binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope)); expect(binding.eol).toBe('mixed');
    expect(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: bytes.toString() }, f.scope)).toMatchObject({ state: 'saved', unchanged: true });
    expect(readFileSync(f.path)).toEqual(bytes);
    expect(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '编辑\n' }, f.scope)).toMatchObject({ state: 'blocked', reason: 'mixed-eol', wrote: 'no' });
    saved(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '编辑\n', eol: 'crlf' }, f.scope));
    expect(readFileSync(f.path, 'utf8')).toBe('编辑\r\n'); expect(readdirSync(f.directory).some(name => name.endsWith('.tmp'))).toBe(false);
  });
  it('外改、替换和删除均拒绝，保留原输入及文件现状', async () => {
    for (const kind of ['change', 'replace', 'delete']) {
      const f = await fixture(), binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
      if (kind === 'replace') { renameSync(f.path, f.path + '.old'); writeFileSync(f.path, '替换'); }
      else if (kind === 'delete') rmSync(f.path); else writeFileSync(f.path, '外部修改');
      const result = await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '待保存输入' }, f.scope);
      expect(result).toMatchObject({ state: 'blocked', wrote: 'no', reason: kind === 'replace' ? 'identity-changed' : kind === 'delete' ? 'missing' : 'external-change' });
      if (kind !== 'delete') expect(readFileSync(f.path, 'utf8')).toBe(kind === 'replace' ? '替换' : '外部修改');
      expect(f.store.settings().tabs[0].sql).toBe('select 1;\n');
    }
  });
  it('两tab打开同文件，先保存后另一tab旧基线拒绝且另存不能覆盖其他tab来源', async () => {
    const f = await fixture(undefined, ['one', 'two']);
    const first = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
    const second = opened(await f.service.open({ taskId: randomUUID(), tabId: 'two', encoding: 'utf8' }, f.scope));
    saved(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: first.ref, sql: '第一标签' }, f.scope));
    expect(await f.service.save({ taskId: randomUUID(), tabId: 'two', source: second.ref, sql: '第二标签' }, f.scope)).toMatchObject({ state: 'blocked', wrote: 'no' });
    expect(await f.service.saveAs({ taskId: randomUUID(), tabId: 'two', source: second.ref, sql: '另存', encoding: 'utf8', bom: 'none', eol: 'lf' }, f.scope)).toMatchObject({ state: 'blocked', wrote: 'no' });
    expect(readFileSync(f.path, 'utf8')).toBe('第一标签');
  });
  it('原生取消和文件选择晚返的文档失效不建立来源或覆盖新输入', async () => {
    const f = await fixture(); f.choose(undefined);
    expect(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope)).toEqual({ state: 'cancelled' });
    f.host.choose = async () => { f.store.saveSettings({ ...f.store.settings(), tabs: [] }); f.store.saveSettings({ ...defaultSettings, tabs: [{ id: 'one', kind: 'query', title: '新文档', connectionId: 'ram', sql: '新输入' }] }); return f.path; };
    expect(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope)).toMatchObject({ state: 'blocked', reason: 'document-changed', wrote: 'no' });
    expect(f.store.settings().tabs[0].sql).toBe('新输入'); expect(f.service.status({ tabId: 'one' }, f.scope)).toEqual({ state: 'unbound' });
  });
  it('读取期间输入变化阻止打开文件替换原正文', async () => {
    const f = await fixture(); f.host.choose = async () => { f.store.saveSettings({ ...f.store.settings(), tabs: [{ ...f.store.settings().tabs[0], sql: '用户继续输入' }] }); return f.path; };
    expect(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope)).toMatchObject({ state: 'blocked', reason: 'document-changed', wrote: 'no' });
    expect(f.store.settings().tabs[0].sql).toBe('用户继续输入');
  });
  it('另存授权建立关联，UTF16LE无BOM可重启读取，旧release不删新修订', async () => {
    const f = await fixture(), target = join(f.directory, '新脚本.sql'); f.choose(target);
    const binding = saved(await f.service.saveAs({ taskId: randomUUID(), tabId: 'one', sql: '中文\n', encoding: 'utf16le', bom: 'none', eol: 'crlf' }, f.scope));
    expect(readFileSync(target)).toEqual(Buffer.from('中文\r\n', 'utf16le'));
    const next = saved(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '更新\n' }, f.scope));
    expect(await f.service.release({ tabId: 'one', source: binding.ref }, f.scope)).toEqual({ released: false });
    expect(f.service.status({ tabId: 'one' }, f.scope)).toMatchObject({ state: 'bound', binding: { ref: next.ref } });
    expect(await f.service.release({ tabId: 'one', source: next.ref }, f.scope)).toEqual({ released: true });
    expect(f.store.settings().tabs[0].fileSourceBinding).toBeUndefined(); expect(readFileSync(target).length).toBeGreaterThan(0);
  });
  it('文件已写而本地来源提交失败明确wrote=yes，不重放也不回退旧正文', async () => {
    const f = await fixture(), binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
    mkdirSync(f.database + '.tmp');
    const result = await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '已经写成' }, f.scope);
    expect(result).toMatchObject({ state: 'blocked', reason: 'storage', wrote: 'yes' });
    expect(readFileSync(f.path, 'utf8')).toBe('已经写成'); expect(f.store.queryFileSource('one')?.ref).toEqual(binding.ref);
    expect(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '不重放' }, f.scope)).toMatchObject({ state: 'blocked', wrote: 'no' });
    expect(readFileSync(f.path, 'utf8')).toBe('已经写成');
  });
  it('在途预约取消后精确释放，晚返回不写文件；导航失效同样阻止保存', async () => {
    const f = await fixture(), binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
    let resume!: () => void, entered!: () => void; const entry = new Promise<void>(resolve => { entered = resolve; });
    let releases = 0; f.host.reserve = async () => { entered(); await new Promise<void>(resolve => { resume = resolve; }); return () => { releases++; }; };
    const write = f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '不能写入' }, f.scope); await entry;
    expect(await f.service.save({ taskId: randomUUID(), tabId: 'one', source: binding.ref, sql: '重复点击' }, f.scope)).toMatchObject({ state: 'blocked', reason: 'busy' });
    const release = f.service.release({ tabId: 'one', source: binding.ref }, f.scope); resume();
    expect(await write).toMatchObject({ state: 'blocked', wrote: 'no' }); expect(await release).toEqual({ released: true }); expect(releases).toBe(1); expect(readFileSync(f.path, 'utf8')).toBe('select 1;\n');
    const second = await fixture(), other = opened(await second.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, second.scope)); second.invalidate();
    expect(await second.service.save({ taskId: randomUUID(), tabId: 'one', source: other.ref, sql: '失效' }, second.scope)).toMatchObject({ state: 'blocked', wrote: 'no' });
  });
  it('临时文件建立后文档失效仍关闭并精确清理，原文件不变', async () => {
    const f = await fixture(), snapshot = await readQueryFileSnapshot(f.path, () => undefined);
    const check = () => { if (readdirSync(f.directory).some(name => name.includes('.dbark-'))) throw Error('原文档已取消'); };
    let wrote = 'no';
    await expect(writeBoundQueryFile(f.path, Buffer.from('不能替换'), snapshot, check, state => { wrote = state; })).rejects.toThrow('原文档');
    expect(wrote).toBe('no'); expect(readFileSync(f.path, 'utf8')).toBe('select 1;\n'); expect(readdirSync(f.directory).some(name => name.includes('.dbark-'))).toBe(false);
  });
  it('rename已返回后文档失效保留已写事实，不回滚文件或留下临时文件', async () => {
    const f = await fixture(), snapshot = await readQueryFileSnapshot(f.path, () => undefined);
    let wrote = 'no', cancelled = false;
    await expect(writeBoundQueryFile(f.path, Buffer.from('已经替换'), snapshot, () => { if (cancelled) throw Error('文档在写后取消'); }, state => { wrote = state; if (state === 'yes') cancelled = true; })).rejects.toThrow('写后取消');
    expect(wrote).toBe('yes'); expect(readFileSync(f.path, 'utf8')).toBe('已经替换'); expect(readdirSync(f.directory).some(name => name.includes('.dbark-'))).toBe(false);
  });
});

describe('私有配置迁移与坏记录边界', () => {
  it('分块文档检查不重复解析正文，事务成功及失败后均重取并保留最新输入', async () => {
    const f = await fixture(); let reads = 0; const settings = f.store.settings.bind(f.store);
    f.store.settings = () => { reads++; return settings(); };
    for (let i = 0; i < 100; i++) expect(f.store.queryFileDocument('one').tab.sql).toBe(''); expect(reads).toBe(1);
    f.store.saveSettings({ ...settings(), tabs: [{ ...settings().tabs[0], sql: '新输入' }] });
    const afterWrite = reads; expect(f.store.queryFileDocument('one').tab.sql).toBe('新输入'); expect(reads).toBe(afterWrite + 1);
    mkdirSync(f.database + '.tmp'); expect(() => f.store.saveSettings({ ...settings(), tabs: [] })).toThrow();
    const afterFailure = reads; expect(f.store.queryFileDocument('one').tab.sql).toBe('新输入'); expect(reads).toBe(afterFailure + 1);
  });
  it('真实schema8原子升9、旧settings字节不变、迁移失败原文件不变', async () => {
    const f = await fixture(); f.store.close(); stores.delete(f.store);
    const db = new SQL.Database(readFileSync(f.database)); db.run('DROP TABLE query_file_sources'); db.run('PRAGMA user_version=8'); const original = db.exec('SELECT data FROM settings'); writeFileSync(f.database, db.export()); db.close();
    const before = readFileSync(f.database); mkdirSync(f.database + '.tmp');
    await expect(LocalStore.open(f.database, wasm, protector)).rejects.toThrow('修改未保存'); expect(readFileSync(f.database)).toEqual(before); rmSync(f.database + '.tmp', { recursive: true });
    const store = await LocalStore.open(f.database, wasm, protector); stores.add(store);
    const persisted = new SQL.Database(readFileSync(f.database)); expect(persisted.exec('PRAGMA user_version')[0].values[0][0]).toBe(9); expect(persisted.exec('SELECT data FROM settings')).toEqual(original); persisted.close();
  });
  it('未来schema10拒绝且坏来源不抹SQL，不猜测删除未知来源', async () => {
    const f = await fixture(); f.store.saveSettings({ ...f.store.settings(), tabs: [{ ...f.store.settings().tabs[0], sql: '保留正文' }] }); f.store.close(); stores.delete(f.store);
    const db = new SQL.Database(readFileSync(f.database)); db.run('INSERT INTO query_file_sources VALUES(?,?,?,?)', ['one', randomUUID(), 1, '{坏JSON']); writeFileSync(f.database, db.export()); db.close();
    const store = await LocalStore.open(f.database, wasm, protector); stores.add(store);
    expect(store.settings().tabs[0]).toMatchObject({ sql: '保留正文' }); expect(store.settings().tabs[0].fileSourceBinding).toBeUndefined(); expect(() => store.queryFileSource('one')).toThrow('来源损坏');
    store.saveSettings(store.settings()); expect(() => store.queryFileSource('one')).toThrow(); store.close(); stores.delete(store);
    const future = new SQL.Database(readFileSync(f.database)); future.run('PRAGMA user_version=10'); writeFileSync(f.database, future.export()); future.close(); const before = readFileSync(f.database);
    await expect(LocalStore.open(f.database, wasm, protector)).rejects.toThrow('更新版本'); expect(readFileSync(f.database)).toEqual(before);
  });
  it('文档移除精确释放授权，renderer复制引用到其他tab不能获得文件能力', async () => {
    const f = await fixture(undefined, ['one', 'two']), binding = opened(await f.service.open({ taskId: randomUUID(), tabId: 'one', encoding: 'utf8' }, f.scope));
    f.store.saveSettings({ ...f.store.settings(), tabs: f.store.settings().tabs.map(tab => ({ ...tab, fileSourceBinding: binding.ref })) });
    expect(f.store.settings().tabs[1].fileSourceBinding).toBeUndefined();
    expect(await f.service.save({ taskId: randomUUID(), tabId: 'two', source: binding.ref, sql: '伪造来源' }, f.scope)).toMatchObject({ state: 'blocked', wrote: 'no' });
    f.store.saveSettings({ ...f.store.settings(), tabs: f.store.settings().tabs.filter(tab => tab.id !== 'one') }); expect(f.store.queryFileSource('one')).toBeUndefined();
  });
  it('编码无损门及预算拒绝不分配大型输出，换行分类无隐式转换', () => {
    expect(queryFileEol('a\r\nb\n')).toBe('mixed');
    expect(queryFileEol('\r\n'.repeat(100_000))).toBe('crlf');
    expect(queryFileEol('无换行')).toBe('none'); expect(queryFileEol('a\rb\r')).toBe('cr');
    expect(() => encodeBoundQueryFile('\ud800', 'utf8', 'none', 'lf', 'preserve')).toThrow('无损');
    expect(() => encodeBoundQueryFile('a'.repeat(20_000_001), 'utf8', 'none', 'none', 'preserve')).toThrow();
    expect(encodeBoundQueryFile('中文\n', 'gb18030', 'none', 'crlf', 'preserve').length).toBeGreaterThan(4);
  });
});
