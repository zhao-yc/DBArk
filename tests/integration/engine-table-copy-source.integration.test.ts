import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { beforeAll, describe, it } from 'vitest';
import { d02CopyConfig, d02CopyEnabled, d02Fact, type D02CopyConfig } from './helpers/d02-copy-source-policy';
import type { TablePage } from '../../src/shared/contracts';

// 默认只读取双开关；Engine/mysql2/CA仅在开启后的beforeAll动态导入，不加载任何.env。
const enabled = d02CopyEnabled(process.env);
let config: D02CopyConfig, withCase: typeof import('./helpers/d02-copy-source-fixture')['withD02CopyCase'];

/** 失败只保留固定分类，不能把意外成功的完整行或驱动原文交给断言框架打印。 */
async function rejected(pending: Promise<unknown>, reason: string): Promise<void> {
  let failure: unknown; try { await pending; } catch (error) { failure = error; }
  d02Fact(failure && typeof failure === 'object' && 'reason' in failure && failure.reason === reason, 'D02读取没有按预期完整拒绝，不能认定安全通过');
}

/** 引用从真实Engine页提取，任何未签发/错位均中断，不能由测试辅助层制造来源。 */
function ready(page: TablePage) {
  d02Fact(page.copySource?.status === 'ready' && page.copySource.rowRefs.length === page.rows.length && page.copySource.rowRefs[0], 'D02真实页未签发完整来源');
  d02Fact(page.copyMetadataKey === page.copySource.metadataKey, 'D02页与租约结构身份不一致'); return page.copySource;
}

describe.skipIf(!enabled)('D02完整复制源真实Engine验收准备（ROOT独占双门）', () => {
  beforeAll(async () => { config = d02CopyConfig(process.env); withCase = (await import('./helpers/d02-copy-source-fixture')).withD02CopyCase; }, 30000);

  it('INVISIBLE混合非默认精确值经公开校验及正式Engine补取，观察连接证明未自动写入', async () => {
    await withCase(config, async context => {
      const before = await context.observe(), page = await context.page(), source = ready(page);
      d02Fact(before.length === 1 && !Object.hasOwn(page.rows[0], 'hidden_big') && source.missingColumns.includes('hidden_big'), 'D02独立事实或真实缺列条件不成立');
      const result = await context.read(page), fact = before[0];
      d02Fact(result.complete && result.values.id === fact.id && result.values.hidden_big === fact.big && result.values.hidden_decimal === fact.amount && result.values.hidden_stamp === fact.stamp && result.values.hidden_null === fact.nullable, 'D02完整标量/NULL精度与独立观察事实不同');
      const columns = await context.sql('SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?', [context.database, 'subject']);
      d02Fact(result.values.note === fact.note && result.values.computed === fact.computed && Object.keys(result.values).length === columns.length && columns.every(column => Object.hasOwn(result.values, String(column.name)) && result.values[String(column.name)] !== undefined), 'D02完整投影与独立列目录或已加载值不符');
      const binary = result.values.hidden_blob; d02Fact(binary && typeof binary === 'object' && binary.type === 'binary' && Buffer.from(binary.base64, 'base64').toString('hex').toUpperCase() === fact.blob, 'D02完整二进制与独立字节事实不同');
      d02Fact(typeof result.readAt === 'string' && Number.isFinite(Date.parse(result.readAt)), 'D02没有真实读取时点');
      context.assertSame(await context.observe(), before, 'D02只读补取后行值或条数发生变化'); await context.release(page);
    });
  }, 60000);

  it('已加载值并发更新后拒绝旧来源，不混合旧可见值与新缺列值', async () => {
    await withCase(config, async context => { const page = await context.page(); ready(page); await context.write(`UPDATE ${context.table} SET note=? WHERE id=?`, ['并发新值', '9007199254740993']); const changed = await context.observe(); d02Fact(changed.length === 1 && changed[0].note === '并发新值', 'D02并发UPDATE没有独立确认'); await rejected(context.read(page), 'changed'); context.assertSame(await context.observe(), changed, 'D02拒绝旧来源时意外改写数据'); await context.release(page); });
  }, 60000);

  it('同名同定义且键值相同的重建因真实物理TABLE_ID变化拒绝', async () => {
    await withCase(config, async context => { const page = await context.page(); ready(page); const before = await context.observe(), definition = (await context.sql('SHOW CREATE TABLE ' + context.table))[0]['Create Table'], old = await context.sql('SELECT CAST(TABLE_ID AS CHAR) AS id FROM information_schema.INNODB_TABLES WHERE NAME=?', [context.database + '/subject']); d02Fact(old.length === 1, 'D02观察不到原物理表身份'); await context.write('DROP TABLE ' + context.table); await context.recreate(); const current = await context.sql('SELECT CAST(TABLE_ID AS CHAR) AS id FROM information_schema.INNODB_TABLES WHERE NAME=?', [context.database + '/subject']); d02Fact(current.length === 1 && old[0].id !== current[0].id, 'D02服务器没有独立证实物理重建'); context.assertSame((await context.sql('SHOW CREATE TABLE ' + context.table))[0]['Create Table'], definition, 'D02重建后的真实DDL与原定义不同'); context.assertSame(await context.observe(), before, 'D02重建后的真实键值与原行不同'); await rejected(context.read(page), 'changed'); await context.release(page); });
  }, 60000);

  it('实际DDL新增INVISIBLE后旧定义来源拒绝，不把新增字段当DEFAULT拼接', async () => {
    await withCase(config, async context => { const page = await context.page(); ready(page); await context.write('ALTER TABLE ' + context.table + ' ADD COLUMN drift INT INVISIBLE DEFAULT 17'); const columns = await context.sql('SELECT COLUMN_NAME AS name,EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?', [context.database, 'subject', 'drift']); d02Fact(columns.length === 1 && String(columns[0].extra).includes('INVISIBLE'), 'D02观察连接未证实DDL漂移'); await rejected(context.read(page), 'changed'); await context.release(page); });
  }, 60000);

  it('原可靠键失效、显式释放及真实五分钟TTL到期均拒绝，禁止注入自造键', async () => {
    await withCase(config, async context => {
      const first = await context.page(), source = ready(first), created = context.driverCount();
      let refused = false; try { await context.dispatch('table.copySourceRead', { connectionId: context.profile.id, taskId: randomUUID(), pageRef: source.pageRef, rowRef: source.rowRefs[0]!, key: '自造键' } as never); } catch { refused = true; }
      d02Fact(refused && context.driverCount() === created, 'D02公开输入未在建连前拒绝自造键');
      await context.write('UPDATE ' + context.table + ' SET id=? WHERE id=?', ['9007199254740995', '9007199254740993']); const afterKey = await context.observe(); d02Fact(afterKey[0].id === '9007199254740995', 'D02原可靠键变更未被观察确认'); await rejected(context.read(first), 'changed'); await context.release(first);
      const second = await context.page(); ready(second); await context.release(second); await rejected(context.read(second), 'expired');
      const expiring = await context.page(), lease = ready(expiring), serverStart = (await context.sql('SELECT CAST(UNIX_TIMESTAMP(NOW(6))*1000000 AS UNSIGNED) AS micros'))[0].micros;
      d02Fact(lease.expiresAt - Date.now() > 290000 && lease.expiresAt - Date.now() <= 300000, 'D02TTL并非原五分钟范围，拒绝缩短或伪造时钟');
      let observedAt = Date.now();
      while (Date.now() <= lease.expiresAt + 100) {
        await delay(Math.min(1000, Math.max(1, lease.expiresAt + 101 - Date.now())));
        if (Date.now() - observedAt >= 10000) { d02Fact((await context.sql('SELECT 1 AS alive')).length === 1, 'D02真实等待期间观察连接已失效'); observedAt = Date.now(); }
      }
      const serverEnd = (await context.sql('SELECT CAST(UNIX_TIMESTAMP(NOW(6))*1000000 AS UNSIGNED) AS micros'))[0].micros; d02Fact(BigInt(String(serverEnd)) - BigInt(String(serverStart)) >= 290000000n, 'D02独立服务器时钟未证实真实等待'); await rejected(context.read(expiring), 'expired'); context.assertSame(await context.observe(), afterKey, 'D02租约释放或到期拒绝后数据发生变化');
    });
  }, 390000);

  it('完整隐藏行超过256KiB整行拒绝，不截断返回或写回', async () => {
    await withCase(config, async context => { await context.write('UPDATE ' + context.table + ' SET hidden_blob=?', [Buffer.alloc(256 * 1024 + 1, 97)]); const before = await context.observe(); d02Fact(Number(before[0].blobBytes) === 256 * 1024 + 1, 'D02观察连接没有证实超预算长度'); const page = await context.page(); ready(page); await rejected(context.read(page), 'budget'); context.assertSame(await context.observe(), before, 'D02预算拒绝后完整行发生改变或裁短'); await context.release(page); });
  }, 60000);

  it('真实MDL等待可由原query.cancel终止，目标线程归零且租约可释放', async () => {
    await withCase(config, async context => {
      const page = await context.page(); ready(page); const blocker = await context.openBlocker(), taskId = randomUUID(); let outcome: Promise<{ failed: boolean }> | undefined; const failures: unknown[] = [];
      try {
        await context.statement(blocker, 'LOCK TABLES ' + context.table + ' WRITE'); const baseline = new Set(context.driverIds());
        outcome = context.read(page, taskId).then(() => ({ failed: false }), () => ({ failed: true }));
        let pending: number[] = []; const end = Date.now() + 8000;
        do { const candidates = context.driverIds().filter(id => !baseline.has(id)); if (candidates.length) { const locks = await context.sql("SELECT t.PROCESSLIST_ID AS id,m.LOCK_STATUS AS status FROM performance_schema.metadata_locks m JOIN performance_schema.threads t ON t.THREAD_ID=m.OWNER_THREAD_ID WHERE m.OBJECT_SCHEMA=? AND m.OBJECT_NAME='subject' AND t.PROCESSLIST_ID IN (" + candidates.map(() => '?').join(',') + ')', [context.database, ...candidates]); pending = locks.filter(row => row.status === 'PENDING').map(row => Number(row.id)); } if (pending.length) break; await delay(40); } while (Date.now() < end);
        d02Fact(pending.length > 0, 'D02没有观察到目标真实MDL等待，不能把普通取消算作通过');
        await context.dispatch('query.cancel', { taskId }); d02Fact((await outcome).failed, 'D02被取消的读取仍返回完整行'); await context.assertGone(context.driverIds().filter(id => !baseline.has(id)));
        const held = await context.sql("SELECT m.LOCK_STATUS AS status FROM performance_schema.metadata_locks m JOIN performance_schema.threads t ON t.THREAD_ID=m.OWNER_THREAD_ID WHERE m.OBJECT_SCHEMA=? AND m.OBJECT_NAME='subject' AND t.PROCESSLIST_ID=?", [context.database, blocker.connection.threadId!]); d02Fact(held.some(row => row.status === 'GRANTED'), 'D02取消误伤了原阻塞连接或锁');
        await context.release(page); await rejected(context.read(page), 'expired');
      } catch (error) { failures.push(error); }
      finally {
        try { await context.dispatch('query.cancel', { taskId }); } catch (error) { failures.push(error); }
        try { await outcome; } catch (error) { failures.push(error); }
        try { await context.statement(blocker, 'UNLOCK TABLES'); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'D02真实MDL验收或锁连接收尾失败', { cause: failures[0] });
    });
  }, 60000);

  it('仅subject SELECT且无PROCESS账号明确降级，不能取得或误用旧管理员来源', async () => {
    await withCase(config, async context => { await context.assertGrants(); const previous = await context.adminSource(), old = ready(previous.page), before = await context.observe(), page = await context.page(); d02Fact(page.rows.length === 1 && page.copySource?.status === 'unavailable' && page.copySource.reason === 'identity-permission', 'D02仅SELECT账号没有明确身份权限降级'); await rejected(context.dispatch('table.copySourceRead', { connectionId: context.profile.id, taskId: randomUUID(), pageRef: old.pageRef, rowRef: old.rowRefs[0]! }), 'expired'); d02Fact((await previous.read()).values.hidden_big === before[0].big, 'D02拒绝跨账号误用时破坏了原管理员来源'); await previous.release(); context.assertSame(await context.observe(), before, 'D02限权查看或拒绝旧管理员来源后源数据变化'); await context.assertGrants(); }, true);
  }, 60000);
});
