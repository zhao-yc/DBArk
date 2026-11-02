const {app,BrowserWindow}=require('electron');
const {resolve,basename}=require('node:path');
// 仅加载本例独占目录及localhost真实组件，不提供数据库、preload或系统剪贴板端口。
const directory=process.env.DBARK_VALUE_FREQUENCY_FIXTURE_DATA,address=new URL(process.env.DBARK_VALUE_FREQUENCY_FIXTURE_URL);
if(process.env.DBARK_VALUE_FREQUENCY_NATIVE!=='1'||process.env.DBARK_INTEGRATION_ENABLED!=='0'||!directory||resolve(directory)!==directory||!basename(directory).startsWith('dbark-value-frequency-native-')||address.protocol!=='http:'||address.hostname!=='127.0.0.1'||address.pathname!=='/tests/fixtures/value-frequency/index.html')throw Error('次数排序组件夹具环境无效');
app.setPath('userData',directory);
app.whenReady().then(async()=>{const window=new BrowserWindow({width:1024,height:680,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await window.loadURL(address.href);});
app.on('window-all-closed',()=>app.quit());
