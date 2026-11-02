const { app, BrowserWindow } = require('electron');
const { resolve, basename } = require('node:path');
// 只加载本轮独占目录与回环组件夹具，不加载产品配置、数据库驱动或认证。
const directory = process.env.DBARK_RELATIONSHIP_FIXTURE_DATA, address = new URL(process.env.DBARK_RELATIONSHIP_FIXTURE_URL);
if (process.env.DBARK_RELATIONSHIP_NATIVE !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || !directory || resolve(directory) !== directory || !basename(directory).startsWith('dbark-relationship-native-') || address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.pathname !== '/tests/fixtures/relationship-diagram/index.html') throw Error('关系图组件夹具环境无效');
app.setPath('userData', directory);
app.whenReady().then(async () => { const window = new BrowserWindow({ width: 1200, height: 940, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await window.loadURL(address.href); });
app.on('window-all-closed', () => app.quit());
