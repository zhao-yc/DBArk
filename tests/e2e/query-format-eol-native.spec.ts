import { test } from '@playwright/test';
import { formatEolActive, bindFormatEolEnvironment, formatEolCases } from '../helpers/queryFormatEolNative';

// 默认/list只登记两例；不引入原生runtime、旧通用fixture或任何R7观察链。
if (!formatEolActive(process.env, process.argv)) for (const name of formatEolCases) test.skip(name, () => {});
else {
  const binding = bindFormatEolEnvironment(() => ({ env: process.env, args: process.argv, platform: process.platform }));
  (require('./query-format-eol-native-live') as typeof import('./query-format-eol-native-live')).registerFormatEolNative(binding);
}
