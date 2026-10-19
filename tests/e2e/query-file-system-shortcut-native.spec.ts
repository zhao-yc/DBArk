import { test } from '@playwright/test';
import { systemShortcutActive, bindSystemShortcutEnvironment, systemShortcutCase } from '../helpers/queryFileSystemShortcutGate';

// 默认/list零资源；正式CI无批准时只跳过，不加载live或握手IO。
if (!systemShortcutActive(process.env, process.argv)) test.skip(systemShortcutCase, () => {});
else {
  const binding = bindSystemShortcutEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform, cwd: process.cwd() }));
  (require('./query-file-system-shortcut-native-live') as typeof import('./query-file-system-shortcut-native-live')).registerSystemShortcutNative(binding);
}
