import { test } from '@playwright/test';

const title = 'SQL文件外改预览、取消、原模型重载撤销及二次外改拒绝';
// 默认/list不加载桌面或文件资源；仅Root的独立队列提供准确源码和一次性owner。
if (process.env.DBARK_QUERY_FILE_RELOAD_UI !== '1' || process.argv.some(arg => /^--list(?:=|$)/.test(arg))) test.skip(title, () => {});
else {
  const owner = process.env.DBARK_QUERY_FILE_RELOAD_OWNER, source = process.env.DBARK_QUERY_FILE_RELOAD_SOURCE;
  if (!owner || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(owner) || !source || !/^[a-f0-9]{40}$/.test(source)) throw Error('文件重载验收缺少准确源码或独立owner');
  const args = [...process.argv]; let current = true;
  const assertCurrent = () => { if (!current || process.env.DBARK_QUERY_FILE_RELOAD_UI !== '1' || process.env.DBARK_QUERY_FILE_RELOAD_OWNER !== owner || process.env.DBARK_QUERY_FILE_RELOAD_SOURCE !== source || process.argv.length !== args.length || args.some((arg, index) => process.argv[index] !== arg)) { current = false; throw Error('文件重载验收的原环境已失效'); } };
  (require('./query-file-reload-live') as typeof import('./query-file-reload-live')).registerQueryFileReloadUi({ owner, source, title, assertCurrent });
}
