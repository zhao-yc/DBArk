import { test, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { c02Failure, c02UiEnabled, withC02UiLifetime } from '../integration/helpers/c02-mtls-policy';
import { C02Desktop } from './c02-mtls-desktop';
import { c02StorageFacts, type C02StorageFacts } from './c02-mtls-storage';
import { c02Assert, createConnection, editConnection, overview, savedOrCleared, testConnection, utilitySelect } from './c02-mtls-ui';

// 模块级跳过早于任何 GUI/文件/实库准备；不导入会读取通用 .env 的 live-helpers。
test.skip(!c02UiEnabled(process.env), '默认关闭：须 ROOT 显式开启核心和 UI 三个开关并取得独占 GUI 时段');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test.setTimeout(300000);

/** 存储断言只接收安全事实，不把密文、明文或完整 profile 作为 expect 实际值。 */
function assertDisk(facts: C02StorageFacts, persistent: boolean, tls: boolean): void {
  c02Assert(facts.profileFound && facts.profileHasNoSecrets && facts.diskHasNoPlaintext && facts.otherSlots === 0, 'C02 实际配置文件或公开概要含秘密');
  c02Assert(facts.passwordSlots === (persistent ? 1 : 0) && facts.tlsSlots === (persistent && tls ? 1 : 0), 'C02 独立秘密槽的实际落盘数量不正确');
  if (persistent) c02Assert(facts.nativeAvailable && facts.passwordDecrypts && facts.tlsDecrypts === tls, 'C02 原生 safeStorage 未证明对应秘密独立解密');
}

/** 原生能力由 Electron 实读；Linux basic_text/未知后端不能计作系统安全加密。 */
async function secureStorage(scope: C02Desktop): Promise<boolean> {
  const info = await scope.page.evaluate(() => window.dbark.invoke('app.info', {}));
  const native = await scope.app!.evaluate(({ safeStorage }) => {
    const available = safeStorage.isEncryptionAvailable();
    const backend = process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined;
    return { available, secure: available && (process.platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(backend ?? '')) };
  });
  c02Assert(info.dataPath === scope.directory && info.encryptionAvailable === native.available, 'C02 应用数据目录或原生加密能力不匹配');
  return native.secure;
}

/** 一次用例一个受限租约和独立 userData；finally 退出 app/utility 后，才让核心夹具逐线程清理。 */
async function runUi(remember: boolean, info: TestInfo): Promise<boolean> {
  const { runC02MtlS } = await import('../integration/helpers/c02-mtls-fixture');
  let unverified = false, storageSecure = false;
  const core = await runC02MtlS(process.env, async lease => {
    let scope: C02Desktop | undefined;
    await withC02UiLifetime(async () => {
      scope = await C02Desktop.create(dirname(dirname(lease.profile.tls!.keyPath!)));
      await scope.start(); storageSecure = await secureStorage(scope);
      if (remember && !storageSecure) { unverified = true; return; }
      const name = `C02 UI ${lease.database}`, id = await createConnection(scope, lease, remember);
      const disk = () => c02StorageFacts(scope!.app!, scope!.directory, id, lease.profile.password!, lease.profile.tls!.passphrase!);
      assertDisk(await disk(), remember, true);
      await utilitySelect(scope, lease, id);
      // 真实退出保存握手、主进程/utility结束，再以同一个独占 userData 重新启动。
      await scope.quit(); await scope.start();
      const restarted = await overview(scope, name);
      c02Assert(restarted.id === id && restarted.publicOnly && restarted.hasPassword === remember && restarted.hasTlsPassphrase === remember, 'C02 真实重启后的概要/秘密标记不正确');
      const form = await editConnection(scope, name);
      if (remember) {
        await savedOrCleared(form, false); await testConnection(form, true);
        await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '取消', exact: true })).click();
        assertDisk(await disk(), true, true); await utilitySelect(scope, lease, id);
        const clear = await editConnection(scope, name); await savedOrCleared(clear, true);
        const cleared = await overview(scope, name);
        c02Assert(cleared.publicOnly && cleared.hasPassword && !cleared.hasTlsPassphrase, 'C02 显式清除没有只移除 TLS 秘密槽');
        assertDisk(await disk(), true, false);
        await scope.quit(); await scope.start();
        const final = await overview(scope, name);
        c02Assert(final.id === id && final.publicOnly && final.hasPassword && !final.hasTlsPassphrase, 'C02 清除 TLS 后重启误删数据库密码或恢复旧 TLS 口令');
        const negative = await editConnection(scope, name);
        await (await (await import('./navigation-menu')).navigationMenuItem(negative, { name: 'TLS / SSL', exact: true })).click(); await testConnection(negative, false);
        await (await (await import('./navigation-menu')).navigationMenuItem(negative, { name: '取消', exact: true })).click();
        assertDisk(await disk(), true, false);
      } else {
        // 不补填任何口令，真实测试必须拒绝；该分支独立证明 volatileSecrets 不跨进程恢复。
        await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: 'TLS / SSL', exact: true })).click(); await testConnection(form, false);
        await (await (await import('./navigation-menu')).navigationMenuItem(form, { name: '取消', exact: true })).click(); assertDisk(await disk(), false, false);
      }
    }, async () => { if (scope) await scope.dispose(); });
  });
  // UI 生命周期与服务端清理全部成功以后，才允许输出无秘密事实或正式跳过未验分支。
  await writeFile(info.outputPath('c02-ui-facts.json'), JSON.stringify({ mode: remember ? '原生安全存储' : '不记住的会话回退', storageSecure, status: unverified ? '未验：系统安全加密不可用' : '完成', uiRestart: !unverified, tlsOnlyClear: remember && !unverified, appAndUtilityClosed: true, fixtureCleaned: true, core }, null, 2));
  return unverified;
}

test('C02 正式表单：原生安全存储、utility SELECT、真实重启恢复与只清 TLS 槽', async ({}, info) => {
  let unverified: boolean;
  try { unverified = await runUi(true, info); } catch (error) { throw c02Failure('C02 原生安全存储 UI 验收失败', error); }
  // 在夹具全部收尾后才正式 skip，保留 Playwright 原跳过异常，不经脱敏包装误变成失败。
  test.skip(unverified, '真实系统安全加密不可用：持久化、重启恢复、清除分支未验；未替换 safeStorage');
});
test('C02 正式表单：不记住时当前会话可用，真实重启不恢复秘密', async ({}, info) => {
  try { await runUi(false, info); } catch (error) { throw c02Failure('C02 不记住会话回退 UI 验收失败', error); }
});
