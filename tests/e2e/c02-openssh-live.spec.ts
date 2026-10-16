import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { c02OpenSshEnabled, c02OpenSshPrivacy, c02OpenSshCheck as check } from '../integration/helpers/c02-openssh-policy';
import { c02Failure, withC02UiLifetime } from '../integration/helpers/c02-mtls-policy';
import type { C02Desktop as Desktop } from './c02-mtls-desktop';

// 专属双门之外不导入材料、数据库、桌面夹具；普通CI既不访问200也不启动GUI。
test.skip(!c02OpenSshEnabled(process.env, 'UI'), '默认关闭：仅ROOT核验独立OpenSSH容器后安排正式窗口');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(300000);

for (const mode of ['password', 'encrypted-key'] as const) for (const remember of [true, false]) {
  test(`C02隔离OpenSSH正式表单：${mode}，${remember ? '原生持久化/重启/仅清SSH' : '仅会话保存/重启不恢复'}`, async ({ trace, screenshot, video }, info) => {
    c02OpenSshPrivacy({ trace, screenshot, video });
    let unverified = '', completed = false;
    try {
      const { withC02OpenSshLease } = await import('../integration/helpers/c02-openssh-fixture');
      const { C02Desktop } = await import('./c02-mtls-desktop');
      const ui = await import('./c02-openssh-ui');
      const fixture = await withC02OpenSshLease(process.env, 'UI', async lease => {
        let scope: Desktop | undefined;
        await withC02UiLifetime(async () => {
          scope = await C02Desktop.create(lease.tempParent); await scope.start();
          if (remember && !await ui.c02OpenSshNativeStorage(scope)) { unverified = '实际系统安全加密不可用，持久恢复路径未验；不得伪造safeStorage'; return; }
          const id = await ui.createC02OpenSshConnection(scope, lease, mode, remember);
          await ui.c02OpenSshStorage(scope, lease, mode, id, remember); await ui.c02OpenSshUtilitySelect(scope, lease, id, mode);
          if (remember) await ui.restartAndClearC02OpenSsh(scope, lease, mode, id);
          else {
            await scope.quit(); await scope.start(); const facts = await ui.c02OpenSshOverview(scope, lease.profile(mode).name);
            check(facts.id === id && facts.publicOnly && !facts.database && !facts.password && !facts.passphrase, 'C02仅会话秘密不应在真实重启后恢复'); await ui.c02OpenSshStorage(scope, lease, mode, id, false);
          }
          completed = true;
        }, async () => { if (scope) await scope.dispose(); });
      });
      await writeFile(info.outputPath('c02-isolated-openssh-facts.json'), JSON.stringify({ fixture, mode, remember, completed, unverified, serverAndNewKeyCleanup: '仍由ROOT统一down及精确归还，不冒充本用例已完成' }, null, 2));
    } catch (error) { throw c02Failure('C02隔离OpenSSH正式UI准备执行失败', error); }
    test.skip(!!unverified, unverified);
  });
}
