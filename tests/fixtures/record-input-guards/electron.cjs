const { app, BrowserWindow } = require('electron');
// 独立沙箱窗口与临时用户目录，只加载调用者提供的回环组件夹具。
app.setPath('userData', process.env.DBARK_RECORD_INPUT_FIXTURE_DATA);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL(process.env.DBARK_RECORD_INPUT_FIXTURE_URL);
});
app.on('window-all-closed', () => app.quit());
