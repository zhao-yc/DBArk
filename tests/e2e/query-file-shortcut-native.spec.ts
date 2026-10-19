import { test } from '@playwright/test';
import { shortcutNativeActive, bindShortcutNativeEnvironment, shortcutNativeCase } from '../helpers/queryFileShortcutGate';

// 默认/list仅登记一例；不能加载runtime、读清单、探端口或启动应用。
if (!shortcutNativeActive(process.env, process.argv)) test.skip(shortcutNativeCase, () => {});
else {
  const binding = bindShortcutNativeEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  (require('./query-file-shortcut-native-live') as typeof import('./query-file-shortcut-native-live')).registerShortcutNative(binding);
}
