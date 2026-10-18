import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approveInstalled, preparePackageIdentity } from './native-editor-ci-identity.mjs';
import { ciContext, packageCleanupAllowed, runNativeEditorSpecialties } from './native-editor-ci.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const platform = process.platform;
if (!['win32', 'darwin'].includes(platform)) throw new Error('安装产物验收只支持 Windows 和 macOS');
if (!['x64', 'arm64'].includes(process.arch)) throw new Error('安装产物验收只支持 x64 和 arm64');
const { version } = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(version)) throw new Error('版本号不能用于安全定位安装产物');
const artifact = join(project, 'release', 'DBArk-' + version + '-' + (platform === 'win32' ? 'win' : 'mac') + '-' + process.arch + '-unsigned.' + (platform === 'win32' ? 'exe' : 'dmg'));
if (!existsSync(artifact)) throw new Error('未找到当前架构的安装产物，请先构建：' + artifact);
// Windows的同步JS realpath会保留RUNNER~1；必须先取与runtime异步realpath一致的原生长路径再建安装根。
const temporaryParent = realpathSync.native(tmpdir());
const temporaryPrefix = 'dbark-package-e2e-';

/** 以独立参数调用固定工具；不经 shell，也不把文件路径拼成命令文本。 */
function command(executable, args, options = {}) {
  const { capture, ...spawnOptions } = options;
  const result = spawnSync(executable, args, { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 120000, stdio: capture ? 'pipe' : 'inherit', ...spawnOptions });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('命令执行失败（' + basename(executable) + '，退出码 ' + result.status + '）：' + (result.stderr?.trim() ?? ''));
  return result.stdout ?? '';
}

/** 相同应用标识会触发升级，安装前查询全部用户级和系统级注册，拒绝覆盖用户现有安装。 */
function windowsInstallations() {
  const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); $entries = @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'DBArk*' } | ForEach-Object { if ($_.InstallLocation) { $_.InstallLocation } else { '<未知安装路径>' } }); ConvertTo-Json -InputObject $entries -Compress";
  return JSON.parse(command(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { capture: true }).replace(/^\uFEFF/, '').trim() || '[]');
}

/** 从系统自身输出读取磁盘映像挂载信息，避免凭路径猜测设备编号。 */
function diskImages() {
  const plist = command('/usr/bin/hdiutil', ['info', '-plist'], { capture: true });
  return JSON.parse(command('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { capture: true, input: plist })).images ?? [];
}

/** 仅匹配本次安装产物，不会分离其他磁盘或其他 DMG。 */
function matchingImage() {
  const canonicalArtifact = realpathSync(artifact);
  return diskImages().filter(item => {
    const imagePath = item['image-path'];
    return typeof imagePath === 'string' && existsSync(imagePath) && realpathSync(imagePath) === canonicalArtifact;
  });
}

if (platform === 'win32' && windowsInstallations().length) throw new Error('检测到已有 DBArk 安装；请在干净的 CI 环境运行安装测试，或使用 DBARK_EXECUTABLE_PATH 验证已有程序');
if (platform === 'darwin' && matchingImage().length) throw new Error('该 DMG 已被挂载；请先自行退出已有挂载，再运行安装产物验收');
const temporary = mkdtempSync(join(temporaryParent, temporaryPrefix));
const applicationDirectory = join(temporary, 'Applications');
const mountDirectory = join(temporary, 'mount');
let installAttempted = false;
let testFailure;
let nativeResult;
const nativeEnabled = process.env.DBARK_NATIVE_EDITOR_CI === '1';
if (process.env.DBARK_NATIVE_EDITOR_CI !== undefined && !['0', '1'].includes(process.env.DBARK_NATIVE_EDITOR_CI)) throw Error('原生专项CI开关必须为0或1');

/** 判断路径是否位于临时根目录内部，拒绝根本身、父级或其他磁盘。 */
function contained(target) {
  const child = relative(temporary, target);
  return !!child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child);
}

/** 删除、卸载或复制前核对根目录和目标的真实范围，拒绝链接替换与父目录跳转。 */
function assertOwnedPath(target) {
  if (dirname(temporary) !== temporaryParent || !basename(temporary).startsWith(temporaryPrefix) || lstatSync(temporary).isSymbolicLink() || realpathSync.native(temporary) !== temporary) throw new Error('临时根目录已改变，拒绝清理');
  if (!contained(resolve(target)) || (existsSync(target) && !contained(realpathSync.native(target)))) throw new Error('目标真实路径超出本次验收目录');
}

/** NSIS 的 /D 与 _?= 必须最后出现且不加引号；独立参数数组加 verbatim 保留原生语义。 */
function installWindows() {
  assertOwnedPath(applicationDirectory);
  installAttempted = true;
  command(artifact, ['/S', '/currentuser', '/D=' + applicationDirectory], { windowsVerbatimArguments: true });
  return join(applicationDirectory, 'DBArk.exe');
}

/** 读取真实 DMG，保留应用资源与权限后在独立 Applications 目录运行。 */
function installMac() {
  assertOwnedPath(mountDirectory); assertOwnedPath(applicationDirectory);
  mkdirSync(mountDirectory); mkdirSync(applicationDirectory);
  installAttempted = true;
  command('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountDirectory, artifact]);
  const application = join(applicationDirectory, 'DBArk.app');
  assertOwnedPath(application);
  command('/usr/bin/ditto', [join(mountDirectory, 'DBArk.app'), application]);
  return join(application, 'Contents', 'MacOS', 'DBArk');
}

/** 从安装目录外运行卸载器并等待完成，保留用户数据，不调用其他安装的卸载程序。 */
function uninstallWindows() {
  assertOwnedPath(applicationDirectory);
  const uninstaller = join(applicationDirectory, 'Uninstall DBArk.exe');
  if (existsSync(uninstaller)) {
    assertOwnedPath(uninstaller);
    const copiedUninstaller = join(temporary, 'uninstall-test.exe');
    assertOwnedPath(copiedUninstaller); copyFileSync(uninstaller, copiedUninstaller);
    command(copiedUninstaller, ['/S', '/currentuser', '/KEEP_APP_DATA', '_?=' + applicationDirectory], { windowsVerbatimArguments: true });
  } else if (existsSync(join(applicationDirectory, 'DBArk.exe'))) throw new Error('测试安装缺少卸载器，保留目录供排查');
  // NSIS 实际注册名带版本且 InstallLocation 可以缺失；启动前已证明没有其他安装，收尾必须全部归零。
  if (existsSync(join(applicationDirectory, 'DBArk.exe')) || windowsInstallations().length) throw new Error('测试安装卸载未完成，保留目录供排查');
}

/** 部分挂载失败也只分离本次 DMG；无法确认卸载时保留目录，不递归删除挂载点。 */
function detachMac() {
  const images = matchingImage();
  if (images.length > 1) throw new Error('本次 DMG 出现多份挂载，拒绝猜测清理目标');
  if (!images.length) return;
  const entities = images[0]['system-entities'] ?? [];
  const ownMount = entities.find(item => item['mount-point'] === mountDirectory);
  const device = ownMount?.['dev-entry'] ?? entities.find(item => /^\/dev\/disk\d+$/.test(item['dev-entry'] ?? ''))?.['dev-entry'];
  if (!/^\/dev\/disk\d+(?:s\d+)*$/.test(device ?? '')) throw new Error('无法确认测试 DMG 的设备编号，保留挂载供排查');
  command('/usr/bin/hdiutil', ['detach', device]);
  if (matchingImage().length) throw new Error('测试 DMG 尚未分离，保留临时目录');
}

try {
  // 先封存同job安装输入及未安装app；不能先安装再从当时的新字节补签参考身份。
  const packageProof = process.env.DBARK_NATIVE_EDITOR_CI === '1' ? preparePackageIdentity({
    sourcePath: process.env.DBARK_NATIVE_EDITOR_SOURCE_APPROVAL,
    sourceHash: process.env.DBARK_NATIVE_EDITOR_SOURCE_APPROVAL_SHA256,
    referenceExecutable: process.env.DBARK_NATIVE_EDITOR_REFERENCE_EXECUTABLE,
    context: ciContext(project), artifact, project, platform,
  }) : undefined;
  console.log('正在验证真实安装产物：' + basename(artifact));
  const executable = platform === 'win32' ? installWindows() : installMac();
  assertOwnedPath(executable);
  if (!existsSync(executable)) throw new Error('安装产物中缺少 DBArk 可执行文件');
  // Windows私有helper以固定资源置于asar外；先核真实安装字节，不执行文件协议。
  if (platform === 'win32') {
    const helper = join(dirname(executable), 'resources', 'database-backup-windows', 'databaseBackupWindowsFiles.helper.cs');
    assertOwnedPath(helper);
    const info = lstatSync(helper);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 65536) throw Error('安装的Windows helper资源无效');
    const actual = createHash('sha256').update(readFileSync(helper)).digest('hex');
    const source = createHash('sha256').update(readFileSync(join(project, 'src/engine/databaseBackupWindowsFiles.helper.cs'))).digest('hex');
    if (actual !== source) throw Error('安装的Windows helper资源与固定源码摘要不一致');
    console.log('Windows helper安装资源摘要已核对（未执行协议）：' + actual);
  }
  console.log('正在运行离线安装程序回归：' + executable);
  if (packageProof) {
    const output = join(project, 'test-results/native-editor-ci');
    const approval = approveInstalled(packageProof, executable, output);
    nativeResult = runNativeEditorSpecialties({ approval, output });
  }
  // 普通与C02专用夹具统一使用本次安装所得程序，覆盖父进程继承的旧路径。
  const env = { ...process.env, DBARK_EXECUTABLE_PATH: executable, DBARK_C02_EXECUTABLE_PATH: executable, DBARK_INTEGRATION_ENABLED: '0' };
  delete env.DBARK_DEV_URL;
  // 安装完成且环境归一后才做同一固定预检，紧邻真正Playwright启动；关门时不执行网络检查。
  if (env.DBARK_QUERY_CLOSE_OTHERS_NATIVE_TEST === '1') command(process.execPath, [join(project, 'scripts', 'check-offline-query-port.mjs')], { env, timeout: 10000 });
  // 执行当前源码的全部离线用例，避免新增偏好或配置功能遗漏随包验收；内网专属由显式开关跳过。
  // 首批196项源码套件实际耗时298秒；仅全套安装进程预算改为15分钟，单用例期限和断言不变。
  // 新专项CI的普通回归只清独立子目录，不能删除native-editor-ci的批准和终态；旧独立调用保留默认参数。
  command(process.execPath, [join(project, 'node_modules', '@playwright', 'test', 'cli.js'), 'test', ...(process.env.DBARK_NATIVE_EDITOR_CI === '1' ? ['--output=' + join(project, 'test-results/legacy-installed')] : [])], { env, timeout: 900000 });
} catch (error) {
  testFailure = error;
} finally {
  try {
    if (!packageCleanupAllowed(nativeEnabled, nativeResult, testFailure)) {
      // 不卸载、不分离、不删安装根；原用例保留的数据目录/PID仍以原附件为准，不补强停或重试。
      console.error('原生专项退出证明缺失或回归失败，本次安装现场保留：' + temporary);
    } else {
      if (installAttempted) { if (platform === 'win32') uninstallWindows(); else detachMac(); }
      assertOwnedPath(applicationDirectory);
      // 即使系统未返回预期的映像路径，也不能把仍处于其他文件系统的挂载点递归删除。
      if (platform === 'darwin' && existsSync(mountDirectory) && statSync(mountDirectory).dev !== statSync(temporary).dev) throw new Error('挂载点仍位于其他文件系统，拒绝清理');
      rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      console.log('本次测试安装及临时目录已清理');
    }
  } catch (error) {
    console.error('安装清理失败，临时目录保留：' + temporary);
    testFailure = testFailure ? new AggregateError([testFailure, error], '验收与清理均发生错误') : error;
  }
}
if (testFailure) { console.error(testFailure); process.exitCode = 1; }
