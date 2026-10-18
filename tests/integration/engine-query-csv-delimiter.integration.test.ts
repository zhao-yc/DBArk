import { describe, it } from 'vitest';
import { qcsvCases, qcsvEnabled } from '../helpers/queryCsvIntegration';

// 仅登记18个稳定身份；默认/list短路，live、Engine及mysql2只在获准的实际回调内导入。
const enabled = qcsvEnabled(process.env, process.argv);
describe.skipIf(!enabled)('完整流式CSV/CSV ZIP分隔符后台准备（Root另开实跑）', { sequential: true, concurrent: false }, () => {
  for (const scenario of qcsvCases) it('QCSV ' + scenario.id, { timeout: 120000, retry: 0, repeats: 0 }, async context => {
    const { runQcsvCase } = await import('./query-csv-delimiter-live');
    await runQcsvCase(context, scenario);
  });
});
