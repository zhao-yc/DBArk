import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** 在当前原生架构上启动构建产物，确认随包依赖、凭据及生命周期；不回退到开发入口。 */
function packagedExecutable() {
  if (process.platform === 'win32') return join(process.cwd(), 'release', 'win-unpacked', 'DBArk.exe');
  if (process.platform === 'darwin') return join(process.cwd(), 'release', process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'DBArk.app', 'Contents', 'MacOS', 'DBArk');
  throw new Error('安装包验收只支持 Windows 和 macOS');
}

const executable = packagedExecutable();
if (!existsSync(executable)) throw new Error(`未找到当前架构的安装包应用，请先构建：${executable}`);
console.log(`正在验收安装包应用：${executable}`);
// 命令是固定文字，可执行文件通过环境传入，不拼接到 shell 命令。
const result = spawnSync('pnpm exec playwright test tests/e2e/desktop.spec.ts', {
  shell: true, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, DBARK_EXECUTABLE_PATH: executable }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
