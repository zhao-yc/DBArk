const { app, BrowserWindow } = require('electron');
// 每个用例只使用测试创建的独立用户目录，保持真实渲染沙箱、上下文隔离和 Web Worker。
app.setPath('userData', process.env.DBARK_FIND_FIXTURE_DATA);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1024, height: 680, minWidth: 1024, minHeight: 680, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(process.env.DBARK_FIND_FIXTURE_URL);
});
app.on('window-all-closed', () => app.quit());
