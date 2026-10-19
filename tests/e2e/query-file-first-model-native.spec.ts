import { test } from '@playwright/test';
import { fileFirstModelCases } from '../helpers/queryFileFirstModelNative';
import { fileFirstModelActive, bindFileFirstModelEnvironment } from '../helpers/queryFileFirstModelNativeGate';

// 默认与list只登记四例；不加载live/runtime，不读批准文件，不领取原生资源。
if (!fileFirstModelActive(process.env, process.argv)) for (const value of fileFirstModelCases) test.skip(value.title, () => {});
else {
  const binding = bindFileFirstModelEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  (require('./query-file-first-model-native-live') as typeof import('./query-file-first-model-native-live')).registerFileFirstModelNative(binding);
}
