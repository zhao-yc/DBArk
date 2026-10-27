import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const packagePath = new URL('../../package.json', import.meta.url), includePath = new URL('../../build/installer.nsh', import.meta.url);
const manifest = JSON.parse(readFileSync(packagePath, 'utf8')), source = readFileSync(includePath, 'utf8').replaceAll('\r\n', '\n');
const protocol = 'software\\classes\\dbark';
type Cell = { type: 'string' | 'dword'; value: string };
type Registry = Map<string, Map<string, Cell>>;
type Macro = { parameters: string[]; lines: string[] };

/** 仅解析本实际include的参数/宏；不是另写一套注册策略，也不执行NSIS或Windows API。 */
function words(line: string): string[] {
  return Array.from(line.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g), match => match[1] ?? match[2] ?? match[3] ?? match[4]);
}
function program(name: 'customInstall' | 'customUnInstall'): string[] {
  const macros = new Map<string, Macro>(), definitions = new Map<string, string>([['APP_ID', manifest.build.appId], ['APP_EXECUTABLE_FILENAME', manifest.build.productName + '.exe']]);
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const parts = words(lines[index].trim());
    if (parts[0] === '!define') definitions.set(parts[1], parts[2]);
    if (parts[0] !== '!macro') continue;
    const body: string[] = []; while (++index < lines.length && lines[index].trim() !== '!macroend') body.push(lines[index].trim());
    macros.set(parts[1], { parameters: parts.slice(2), lines: body });
  }
  const expand = (selected: string, values: string[] = []): string[] => {
    const macro = macros.get(selected); if (!macro || macro.parameters.length !== values.length) throw Error('未知NSIS宏或参数数量变化');
    const bindings = new Map([...definitions, ...macro.parameters.map((key, index) => [key, values[index]] as const)]), output: string[] = [];
    let include = true;
    for (const raw of macro.lines) {
      const line = raw.replace(/\$\{(\w+)\}/g, (token, key) => bindings.get(key) ?? token), parts = words(line);
      if (parts[0] === '!ifdef') { include = parts[1] === 'APP_64'; continue; }
      if (parts[0] === '!endif') { include = true; continue; }
      if (!include || !line || line.startsWith(';')) continue;
      if (parts[0] === '!insertmacro') output.push(...expand(parts[1], parts.slice(2))); else output.push(line);
    }
    return output;
  };
  return expand(name);
}

/** 注册表模型只提供API返回；所有分支、匹配、写删与寄存器恢复均读取实际NSIS指令。 */
function interpret(name: 'customInstall' | 'customUnInstall', registry: Registry, options: { mode?: string; directory?: string; openError?: number; closeError?: number; failWrite?: number } = {}) {
  const mode = options.mode ?? 'CurrentUser', hive = mode === 'all' ? 'machine' : 'user', instructions = program(name);
  const registers = new Map<string, string>(Array.from({ length: 10 }, (_, index) => ['$' + index, '原寄存器' + index]));
  registers.set('$INSTDIR', options.directory ?? 'C:\\程序 Files\\DBArk'); registers.set('$installMode', mode);
  const initialRegisters = new Map(registers), stack: string[] = [], handles = new Map<string, string>(), mutations: string[] = [];
  const nativeRoots: { root: string; rights: number }[] = [];
  const labels = new Map(instructions.flatMap((line, index) => line.endsWith(':') ? [[line.slice(0, -1), index] as const] : []));
  let error = false, nextHandle = 0, notifications = 0, writes = 0, pc = 0, steps = 0;
  const expand = (value: string) => value.replace(/\$(?:INSTDIR|installMode|\d)/g, name => registers.get(name) ?? (() => { throw Error('未知NSIS变量'); })());
  const address = (path: string, root = hive) => root + ':' + path.toLowerCase();
  const children = (key: string) => [...registry.keys()].filter(candidate => candidate.startsWith(key + '\\') && !candidate.slice(key.length + 1).includes('\\'));
  const create = (key: string) => { const split = key.indexOf(':'); const root = key.slice(0, split + 1), parts = key.slice(split + 1).split('\\'); for (let length = 1; length <= parts.length; length++) { const part = root + parts.slice(0, length).join('\\'); if (!registry.has(part)) registry.set(part, new Map()); } };
  const jump = (label?: string) => { if (!label || label === '0') return; const target = labels.get(label); if (target === undefined) throw Error('未知NSIS跳转标签：' + label); pc = target; };
  while (pc < instructions.length) {
    if (++steps > 10000) throw Error('NSIS有限解释超限');
    const raw = words(instructions[pc++]), op = raw[0], args = raw.slice(1).map(expand);
    if (op.endsWith(':')) continue;
    if (op === 'Push') { stack.push(registers.get(raw[1])!); continue; }
    if (op === 'Pop') { if (!stack.length) throw Error('NSIS栈下溢'); registers.set(raw[1], stack.pop()!); continue; }
    if (op === 'StrCpy') { registers.set(raw[1], args[1]); continue; }
    if (op === 'StrCmpS') { jump(args[0] === args[1] ? args[2] : args[3]); continue; }
    if (op === 'Goto') { jump(args[0]); continue; }
    if (op === 'ClearErrors') { error = false; continue; }
    if (op === 'IfErrors') { jump(error ? args[0] : args[1]); continue; }
    if (op === 'DetailPrint') continue;
    if (op === 'IntOp') { if (args[2] !== '|') throw Error('未知NSIS整数操作'); registers.set(raw[1], String(Number(args[1]) | Number(args[3]))); continue; }
    if (op === 'System::Call') {
      const call = args[0];
      if (call.startsWith('advapi32::RegOpenKeyExW(')) {
        const path = /w "([^"]+)"/.exec(call)?.[1]; if (!path) throw Error('原生注册表键参数无效');
        const nativeRoot = registers.get('$2') === '0x80000002' ? 'machine' : registers.get('$2') === '0x80000001' ? 'user' : (() => { throw Error('未知根句柄'); })();
        nativeRoots.push({ root: nativeRoot, rights: Number(registers.get('$4')) });
        const key = address(path, nativeRoot), status = options.openError ?? (registry.has(key) ? 0 : 2); registers.set('$5', String(status));
        if (status === 0) { const handle = String(++nextHandle); handles.set(handle, key); registers.set('$3', handle); }
      } else if (call.startsWith('advapi32::RegQueryInfoKeyW(')) {
        const key = handles.get(registers.get('$3')!); if (!key) throw Error('查询未知原生句柄');
        registers.set('$6', String(children(key).length)); registers.set('$7', String(registry.get(key)!.size)); registers.set('$5', '0');
      } else if (call.startsWith('advapi32::RegCloseKey(')) { const result = options.closeError ?? 0; if (result === 0) handles.delete(registers.get('$3')!); registers.set('$8', String(result)); }
      else if (call.startsWith('shell32::SHChangeNotify(')) notifications++;
      else throw Error('未建模原生调用，不能静默假通过');
      continue;
    }
    if (op === 'ReadRegStr' || op === 'ReadRegDWORD') {
      if (args[1] !== 'SHELL_CONTEXT') throw Error('注册表读取绕过安装上下文');
      const cell = registry.get(address(args[2]))?.get(args[3].toLowerCase()), expected = op === 'ReadRegDWORD' ? 'dword' : 'string';
      if (!cell || cell.type !== expected) { error = true; registers.set(raw[1], ''); } else registers.set(raw[1], cell.value);
      continue;
    }
    if (op === 'WriteRegStr' || op === 'WriteRegDWORD') {
      if (args[0] !== 'SHELL_CONTEXT') throw Error('注册表写入绕过安装上下文');
      if (++writes === options.failWrite) { error = true; continue; }
      const key = address(args[1]); create(key); registry.get(key)!.set(args[2].toLowerCase(), { type: op === 'WriteRegDWORD' ? 'dword' : 'string', value: args[3] }); mutations.push(op + ':' + key + ':' + args[2]); continue;
    }
    if (op === 'DeleteRegValue') { const key = address(args[1]); if (args[0] !== 'SHELL_CONTEXT') throw Error('错误删除根'); registry.get(key)?.delete(args[2].toLowerCase()); mutations.push(op + ':' + key + ':' + args[2]); continue; }
    if (op === 'DeleteRegKey') {
      if (args[0] !== '/ifempty' || args[1] !== 'SHELL_CONTEXT') throw Error('禁止递归删除注册树');
      const key = address(args[2]);
      // 特意模拟legacy NSIS只核子键的行为；产品必须先用原生shape证明值数也为零。
      if (registry.has(key) && !children(key).length) registry.delete(key); mutations.push(op + ':' + key); continue;
    }
    throw Error('未知NSIS指令：' + op);
  }
  expect(stack).toEqual([]); expect(registers).toEqual(initialRegisters);
  if (!options.closeError) expect(handles.size).toBe(0);
  return { mutations, notifications, writes, nativeRoots };
}

function snapshot(registry: Registry) { return [...registry].map(([key, values]) => [key, [...values].sort()] as const).sort(); }
function owned(mode: 'CurrentUser' | 'all' = 'CurrentUser') { const registry: Registry = new Map(); interpret('customInstall', registry, { mode }); return registry; }

describe('对象URI安装配置与实际include有限解释（不代表原生安装验收）', () => {
  it('仅macOS声明dbark scheme，NSIS显式include且原配置边界不变', () => {
    expect(manifest.build.mac.protocols).toEqual([{ name: 'DBArk 对象链接', schemes: ['dbark'], role: 'Viewer' }]);
    expect(manifest.build.protocols).toBeUndefined(); expect(manifest.build.win.protocols).toBeUndefined();
    expect(manifest.build.nsis).toEqual({ oneClick: false, allowToChangeInstallationDirectory: true, installerLanguages: ['zh_CN'], include: 'build/installer.nsh' });
    const { protocols: _protocols, ...previousMac } = manifest.build.mac;
    expect(previousMac).toEqual({ target: ['dmg', 'zip'], icon: 'build/icon.icns', category: 'public.app-category.developer-tools', identity: '-' });
    expect(source).not.toMatch(/UseOriginalUrlEncoding|IfShellVarContextAll\s+\w|\b(?:Exec|ExecWait|ExecShell|nsExec::Exec)\s/);
  });

  it('真实本地builder提供所用hook/变量/位视图，测试不调用编译器', () => {
    const require = createRequire(import.meta.url), builder = require.resolve('electron-builder/package.json');
    const library = dirname(require.resolve('app-builder-lib/package.json', { paths: [dirname(builder)] }));
    const install = readFileSync(join(library, 'templates/nsis/installSection.nsh'), 'utf8');
    const uninstall = readFileSync(join(library, 'templates/nsis/uninstaller.nsh'), 'utf8');
    const common = readFileSync(join(library, 'templates/nsis/common.nsh'), 'utf8'), multiUser = readFileSync(join(library, 'templates/nsis/multiUser.nsh'), 'utf8');
    expect(install).toContain('!insertmacro customInstall'); expect(uninstall).toContain('!insertmacro customUnInstall');
    expect(common).toContain('!define APP_EXECUTABLE_FILENAME "${PRODUCT_FILENAME}.exe"'); expect(common).toContain('SetRegView 64');
    expect(multiUser).toMatch(/StrCpy \$installMode CurrentUser\s+SetShellVarContext current/); expect(multiUser).toMatch(/StrCpy \$installMode all\s+SetShellVarContext all/);
    expect(source).toContain('RegQueryInfoKeyW(p r3, p 0, p 0, p 0, *i .r6, p 0, p 0, *i .r7, p 0, p 0, p 0, p 0)');
    expect(source).not.toContain('${__LINE__}');
  });

  it.each(['CurrentUser', 'all'] as const)('新安装按%s正确注册实际EXE及唯一quoted URI，另一根不受影响', mode => {
    const registry: Registry = new Map(), directory = 'C:\\程序 Files\\DBArk %app% & test';
    const result = interpret('customInstall', registry, { mode, directory }), root = mode === 'all' ? 'machine:' : 'user:';
    expect(result.notifications).toBe(1); expect(result.writes).toBe(8);
    expect(registry.get(root + protocol + '\\shell\\open\\command')!.get('')!.value).toBe('"' + directory + '\\DBArk.exe" "%1"');
    expect(registry.get(root + protocol)!.get('dbarkownerpath')!.value).toBe(directory + '\\DBArk.exe');
    expect([...registry.keys()].every(key => key.startsWith(root))).toBe(true);
    expect(result.mutations.every(value => value.includes(root + protocol))).toBe(true);
    expect(result.nativeRoots.length).toBeGreaterThan(0); expect(result.nativeRoots.every(item => item.root + ':' === root && item.rights === 0x20119)).toBe(true);
  });

  it.each(['CurrentUser', 'all'] as const)('同一路径完整owner可重复安装，%s正确卸载且保留Classes及邻项', mode => {
    const registry = owned(mode), root = mode === 'all' ? 'machine:' : 'user:';
    registry.set(root + 'software\\classes\\foreign', new Map([['', { type: 'string', value: '外来数据' }]]));
    expect(interpret('customInstall', registry, { mode }).writes).toBe(8);
    const result = interpret('customUnInstall', registry, { mode }); expect(result.notifications).toBe(1);
    expect(registry.has(root + protocol)).toBe(false); expect(registry.get(root + 'software\\classes\\foreign')!.get('')!.value).toBe('外来数据'); expect(registry.has(root + 'software\\classes')).toBe(true);
    expect(result.mutations.every(value => value.includes(root + protocol))).toBe(true);
  });

  it.each([
    { name: '空既有键', setup(registry: Registry) { registry.set('user:' + protocol, new Map()); } },
    { name: '外来处理程序', setup(registry: Registry) { registry.set('user:' + protocol, new Map([['', { type: 'string', value: 'URL:外来应用' }]])); } },
  ])('$name安装不无声覆盖', ({ setup }) => {
    const registry: Registry = new Map(); setup(registry); const before = snapshot(registry);
    const result = interpret('customInstall', registry); expect(result.mutations).toEqual([]); expect(snapshot(registry)).toEqual(before);
  });

  it.each([5, 87])('无法核存在性时不把原生错误%s当作fresh', openError => {
    const registry: Registry = new Map(); expect(interpret('customInstall', registry, { openError }).mutations).toEqual([]); expect(registry.size).toBe(0);
  });

  it.each(['customInstall', 'customUnInstall'] as const)('%s拒绝不同安装路径，即使AppID相同也不改写原注册', hook => {
    const registry = owned(), before = snapshot(registry);
    expect(interpret(hook, registry, { directory: 'D:\\另一个DBArk' }).mutations).toEqual([]); expect(snapshot(registry)).toEqual(before);
  });

  it.each([
    { key: '', name: 'DBArkOwner', value: 'another.app' }, { key: '', name: 'DBArkOwnerPath', value: 'D:\\foreign.exe' },
    { key: '', name: 'URL Protocol', value: '外来值' }, { key: '', name: '', value: 'URL:外来描述' },
    { key: '\\DefaultIcon', name: '', value: 'foreign.ico,0' }, { key: '\\shell', name: '', value: 'foreignVerb' },
    { key: '\\shell\\open\\command', name: '', value: '"C:\\foreign.exe" "%1"' },
  ])('已变更注册字段$key/$name在卸载/重装时整体保留', ({ key, name, value }) => {
    const registry = owned(); registry.get('user:' + protocol + key.toLowerCase())!.set(name.toLowerCase(), { type: 'string', value }); const before = snapshot(registry);
    for (const hook of ['customInstall', 'customUnInstall'] as const) { expect(interpret(hook, registry).mutations).toEqual([]); expect(snapshot(registry)).toEqual(before); }
  });

  it.each([
    { key: '', name: 'DBArkOwnerVersion', type: 'string' as const, value: '1' },
    { key: '', name: 'DBArkOwnerVersion', type: 'dword' as const, value: '2' },
    { key: '\\shell\\open\\command', name: 'DelegateExecute', type: 'string' as const, value: '{foreign}' },
    { key: '', name: 'ForeignData', type: 'string' as const, value: '不要删除' },
  ])('错误marker类型/版本或附加handler数据不会被删除：$name/$value', ({ key, name, type, value }) => {
    const registry = owned(); registry.get('user:' + protocol + key.toLowerCase())!.set(name.toLowerCase(), { type, value }); const before = snapshot(registry);
    expect(interpret('customUnInstall', registry).mutations).toEqual([]); expect(snapshot(registry)).toEqual(before);
  });

  it('后来加入DDEEXEC子树即保留整套注册，不仅比较旧command', () => {
    const registry = owned(); registry.set('user:' + protocol + '\\shell\\open\\ddeexec', new Map([['', { type: 'string', value: '外来DDE' }]])); const before = snapshot(registry);
    expect(interpret('customUnInstall', registry).mutations).toEqual([]); expect(snapshot(registry)).toEqual(before);
  });

  it('部分写入失败不发布成功通知，也不能在下次安装当作完整owner接管', () => {
    const registry: Registry = new Map(); const first = interpret('customInstall', registry, { failWrite: 3 }); expect(first.notifications).toBe(0); const before = snapshot(registry);
    expect(interpret('customInstall', registry).mutations).toEqual([]); expect(snapshot(registry)).toEqual(before);
  });
});
