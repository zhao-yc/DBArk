import { registerShortcutNative } from './query-file-shortcut-native-live';
import { systemShortcutCase, type bindSystemShortcutEnvironment } from '../helpers/queryFileSystemShortcutGate';
import { SystemShortcutHandshake, type SystemShortcutDriver } from '../helpers/queryFileSystemShortcutHandshake';

/** 仅新系统入口提供等待策略；旧入口无此参数，仍按原Page.keyboard用例执行。 */
export function registerSystemShortcutNative(binding: ReturnType<typeof bindSystemShortcutEnvironment>) {
  const driver: SystemShortcutDriver = {
    caseTitle: systemShortcutCase,
    operator: 'Root',
    async waitForInput(request, current, info) {
      const handshake = new SystemShortcutHandshake(binding.handshake, current);
      try {
        const receipt = await handshake.wait(request); current();
        await info.attach('系统快捷键同nonce输入确认', { body: Buffer.from(JSON.stringify({ ...receipt, designatedInputOperator: driver.operator, reviewer: 'Root', records: handshake.records })), contentType: 'application/json' }); current();
        return receipt;
      } catch (reason) {
        // 仅父内存附录，失败后不再读握手文件、不查SDK、不补按、不清理。
        try { await info.attach('系统快捷键握手停链保留', { body: Buffer.from(JSON.stringify({ records: handshake.records, designatedInputOperator: driver.operator, reviewer: 'Root', pageKeyboardSaveRequests: 0, physicalKeyCountMeasured: false, automaticRetry: false })), contentType: 'application/json' }); }
        catch (attachment) { throw new AggregateError([reason, attachment], '原系统握手失败及内存附录失败', { cause: reason }); }
        throw reason;
      }
    },
  };
  registerShortcutNative(binding, driver);
}
