const { app, BrowserWindow } = require('electron');
const { resolve, basename } = require('node:path');
// 只接受本例创建的独立目录和本地夹具；不加载产品配置、数据库驱动或认证。
const directory = process.env.DBARK_JOIN_ORDER_FIXTURE_DATA, address = new URL(process.env.DBARK_JOIN_ORDER_FIXTURE_URL);
if (process.env.DBARK_JOIN_ORDER_NATIVE !== '1' || process.env.DBARK_INTEGRATION_ENABLED !== '0' || !directory || resolve(directory) !== directory || !basename(directory).startsWith('dbark-join-order-native-') || address.protocol !== 'http:' || address.hostname !== '127.0.0.1' || address.pathname !== '/tests/fixtures/join-order/index.html') throw Error('JOIN组件夹具环境无效');
app.setPath('userData', directory);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1024, height: 680, useContentSize: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(address.href);
});
app.on('window-all-closed', () => app.quit());
