import { afterEach, describe, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { fixedPrefixCases, fixedPrefixOwner, type FixedPrefixOwner } from '../helpers/indexFixedPrefixCore';

const owners = new Map<string, FixedPrefixOwner>();
afterEach(context => { owners.get(context.task.id)?.afterEach(); });
// 所有门和延迟导入均在case体内：真正vitest list只收集标题，连环境门都不读取。
describe.sequential('已有表CHAR/BINARY前缀关闭态核心验收', () => {
for (const [kind, title] of fixedPrefixCases) it(title, { retry: 0, repeats: 0 }, async context => {
  if (process.env.DBARK_INTEGRATION_ENABLED !== '1' || process.env.DBARK_INDEX_FIXED_PREFIX_CORE !== '1') { context.skip(); return; }
  if ([...owners.values()].some(owner => owner.state.retained)) throw Error('前一前缀case已保留现场，停止后续case');
  // result.startTime由Vitest在beforeEach之前建立；扣除已用时间，不在导入或主体开始后续期。
  const elapsed = Date.now() - (context.task.result?.startTime ?? NaN);
  const owner = fixedPrefixOwner(context.task.id, () => performance.now(), context.task.timeout, elapsed); owners.set(context.task.id, owner);
  try {
    const { runFixedPrefixCase } = await owner.run(() => import('./index-fixed-prefix-core-live'));
    await runFixedPrefixCase(kind, owner);
  } catch (reason) { owner.stop(); throw reason; }
});
});
