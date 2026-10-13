import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildMain } from './build.mjs';
const require = createRequire(import.meta.url);
await buildMain();
const server = await createServer();
await server.listen();
const env = { ...process.env, DBARK_DEV_URL: 'http://127.0.0.1:5186' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['.'], { stdio: 'inherit', env, windowsHide: true });
/** 关闭开发入口时连同 Vite 和 Electron 退出，避免遗留占用端口。 */
const stop = async () => { child.kill(); await server.close(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
child.on('exit', async code => { await server.close(); process.exitCode = code ?? 0; });
child.on('error', async error => { console.error('客户端启动失败：', error.message); await stop(); process.exitCode = 1; });
