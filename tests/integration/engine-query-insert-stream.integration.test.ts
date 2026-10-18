import { describe, it } from 'vitest';
import { qisCases, qisEnabled } from '../helpers/queryInsertIntegration';

// 列表先短路，live只在实际回调、双门启用之后加载；默认不读取任何凭据。
const enabled = qisEnabled(process.env, process.argv);
describe.skipIf(!enabled)('完整流式INSERT后台集成准备（Root另开真实运行）', { sequential: true, concurrent: false }, () => {
  for (const kind of qisCases) it('QIS ' + kind, async context => {
    const { runQisCase } = await import('./query-insert-stream-live');
    await runQisCase(context, kind);
  }, { timeout: 120000, retry: 0, repeats: 0 });
});
