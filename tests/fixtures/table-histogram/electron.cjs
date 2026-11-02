const { app, BrowserWindow } = require('electron');
const { resolve, basename } = require('node:path');
// 仅使用本例合成工作区和回环页面，不加载产品配置、驱动、认证或系统剪贴板。
const directory = process.env.DBARK_HISTOGRAM_FIXTURE_DATA, address = new URL(process.env.DBARK_HISTOGRAM_FIXTURE_URL);
if (process.env.DBARK_TABLE_HISTOGRAM_NATIVE !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || !directory || resolve(directory) !== directory || !basename(directory).startsWith('dbark-histogram-native-') || address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.pathname !== '/tests/fixtures/table-histogram/index.html') throw Error('数值分布组件环境无效');
app.setPath('userData', directory);
app.whenReady().then(async () => { const window = new BrowserWindow({ width: 1200, height: 940, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await window.loadURL(address.href); });
app.on('window-all-closed', () => app.quit());
