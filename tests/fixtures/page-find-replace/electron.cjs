const { app, BrowserWindow } = require('electron');
// 每个用例只使用测试创建的独立用户目录，保持真实渲染沙箱、上下文隔离和 Web Worker。
app.setPath('userData', process.env.DBARK_FIND_FIXTURE_DATA);
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1024, height: 680, minWidth: 1024, minHeight: 680, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  /** 固定离线夹具在导航前记录早期失败；只供失败附件定位，不改变加载、超时或退出行为。 */
  const report = (event, detail) => process.stderr.write(JSON.stringify({ fixture: 'page-find-replace', event, ...detail }) + '\n');
  window.webContents.on('did-fail-load', (_event, code, _description, _url, mainFrame) => report('load-failed', { code, mainFrame }));
  window.webContents.on('render-process-gone', (_event, detail) => report('renderer-gone', { reason: detail.reason, exitCode: detail.exitCode }));
  // Electron 44将结构化消息放在首参数；只声明该参数，避免请求已弃用的数值level参数。
  window.webContents.on('console-message', detail => {
    if (detail.level === 'warning' || detail.level === 'error') report('renderer-console', { level: detail.level, message: detail.message.slice(0, 2048) });
  });
  window.webContents.on('did-finish-load', () => report('load-finished', {}));
  try { await window.loadURL(process.env.DBARK_FIND_FIXTURE_URL); }
  catch (error) { report('load-rejected', { code: error.code ?? 'unknown' }); throw error; }
});
app.on('window-all-closed', () => app.quit());
