const { app, BrowserWindow } = require('electron');
// 本夹具只启动自己的沙箱窗口与独立用户目录，不接触实际数据库或用户配置。
app.setPath('userData', process.env.DBARK_BINARY_FIXTURE_DATA);
app.whenReady().then(async () => { const window = new BrowserWindow({ width: 1024, height: 680, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); await window.loadURL(process.env.DBARK_BINARY_FIXTURE_URL); });
app.on('window-all-closed', () => app.quit());
