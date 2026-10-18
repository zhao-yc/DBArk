import { test } from '@playwright/test';
import { queryFilesNativeActive, bindQueryFilesNativeEnvironment, queryFilesNativeCases } from '../helpers/queryFilesNativeGate';

// 声明阶段不引入旧query-files/desktop-fixture或任何live；list即使双门开启也不加载原生资源。
if (!queryFilesNativeActive(process.env, process.argv)) {
  for (const name of queryFilesNativeCases) test.skip(name, () => {});
} else {
  const binding = bindQueryFilesNativeEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  const live = require('./query-files-native-live') as typeof import('./query-files-native-live');
  live.registerQueryFilesNative(binding);
}
