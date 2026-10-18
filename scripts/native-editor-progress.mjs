import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export const nativeProgressStages = Object.freeze(['scan.begin', 'scan.done', 'launch.begin', 'launch.returned', 'prepare.hook', 'prepare.window', 'prepare.statusbar', 'prepare.metrics', 'prepare.done', 'close.source', 'close.request', 'close.handshake', 'close.application', 'close.event', 'close.pids', 'close.done']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const failure = () => { throw Error('原生阶段诊断文件身份未知，保留现场'); };
/** 原生适配器只开普通文件且不截断；RAM端口可完全替换，不加载浏览器或执行IO。 */
export const nativeProgressIO = {
  stat(path) { return shape(fs.lstatSync(path, { bigint: true })); },
  real: fs.realpathSync,
  open(path, mode) {
    const flags = mode === 'create' ? fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_APPEND : mode === 'append' ? fs.constants.O_WRONLY | fs.constants.O_APPEND : fs.constants.O_RDONLY;
    return fs.openSync(path, flags | (fs.constants.O_NOFOLLOW ?? 0), 0o600);
  },
  fstat(fd) { return shape(fs.fstatSync(fd, { bigint: true })); },
  header(fd) { const bytes = Buffer.alloc(4096), count = fs.readSync(fd, bytes, 0, bytes.length, 0); return bytes.subarray(0, count); },
  bytes(fd) { return fs.readFileSync(fd); },
  append(fd, bytes) { return fs.writeSync(fd, bytes); },
  close: fs.closeSync,
};
/** dev/ino用十进制字符串保留完整身份精度，size只用于小日志上界。 */
function shape(stat) { return { file: stat.isFile(), directory: stat.isDirectory(), link: stat.isSymbolicLink(), dev: String(stat.dev), ino: String(stat.ino), links: Number(stat.nlink), size: Number(stat.size) }; }
function id(stat) { return { dev: stat.dev, ino: stat.ino }; }
function same(a, b) { return a.dev === b.dev && a.ino === b.ino; }
/** 每次诊断IO都消费原guard；关闭自身FD始终执行，关闭失败与原错误并存。 */
function access(io, guard) {
  const checked = action => { guard(); const value = action(); guard(); return value; };
  const regular = (path, directory = false) => {
    if (!isAbsolute(path) || resolve(path) !== path) failure();
    const stat = checked(() => io.stat(path));
    if (stat.link || !(directory ? stat.directory : stat.file) || !directory && stat.links !== 1 || checked(() => io.real(path)) !== path) failure();
    return stat;
  };
  const handle = (path, mode, expected, action) => {
    guard(); const fd = io.open(path, mode); let original;
    try {
      guard(); const actual = checked(() => io.fstat(fd));
      if (!actual.file || actual.link || actual.links !== 1 || expected && !same(actual, expected)) failure();
      return action(fd, actual, checked);
    } catch (error) { original = error; throw error; }
    finally {
      try { io.close(fd); } catch (close) { if (original) throw new AggregateError([original, close], '诊断失败且原FD关闭失败', { cause: original }); throw close; }
    }
  };
  return { checked, regular, handle };
}
/** 路径只能由批准清单的固定basename推导，不接受环境或调用者给任意输出文件。 */
function target(options, io, guard) {
  const { regular, handle } = access(io, guard), path = resolve(options.manifestPath);
  if (path !== options.manifestPath || !/^[a-f0-9]{64}$/.test(options.manifestSha256 ?? '')) failure();
  const match = /^(source|installed)-(indent|layout)-manifest\.json$/.exec(basename(path)); if (!match) failure();
  const parent = dirname(path); regular(parent, true);
  const manifestStat = regular(path);
  if (!Number.isSafeInteger(manifestStat.size) || manifestStat.size < 1 || manifestStat.size > 8 * 1024 * 1024) failure();
  handle(path, 'read', manifestStat, (fd, _stat, checked) => { if (hash(checked(() => io.bytes(fd))) !== options.manifestSha256) failure(); });
  const directory = join(parent, match[1] + '-' + match[2]), directoryStat = regular(directory, true);
  return { directory, directoryId: id(directoryStat), path: join(directory, 'progress.ndjson'), phase: match[1], specialty: match[2] };
}
/** producer在单次PW启动前独占创建；首行绑定原manifest及目录/文件身份，绝不覆盖旧现场。 */
export function prepareNativeProgress(options, io = nativeProgressIO) {
  const guard = options.guard ?? (() => {}), own = target(options, io, guard), { handle, regular } = access(io, guard);
  return handle(own.path, 'create', undefined, (fd, stat, checked) => {
    if (!same(regular(own.directory, true), own.directoryId) || !same(regular(own.path), stat)) failure();
    const header = Buffer.from(JSON.stringify({ version: 1, phase: own.phase, specialty: own.specialty, manifestSha256: options.manifestSha256, directory: own.directoryId, file: id(stat) }) + '\n');
    if (checked(() => io.append(fd, header)) !== header.length) throw Error('原生阶段诊断首行未完整写入');
    return Object.freeze({ sha256: hash(header) });
  });
}
/** 默认关闭/list先返回，连stat都不做；RAM通过显式内存端口保持零实际文件写入。 */
export function openNativeProgress(options, io = nativeProgressIO) {
  if (!options.enabled || options.listing) return undefined;
  if (!/^[a-f0-9]{64}$/.test(options.headerSha256 ?? '')) failure();
  const guard = options.guard, own = target(options, io, guard), { checked, regular, handle } = access(io, guard);
  const initial = regular(own.path);
  const header = handle(own.path, 'read', initial, (fd, _stat, read) => {
    const bytes = read(() => io.header(fd)), ending = bytes.indexOf(10); if (ending < 0) failure();
    const line = bytes.subarray(0, ending + 1); if (hash(line) !== options.headerSha256) failure();
    const value = JSON.parse(line.toString('utf8'));
    if (value.version !== 1 || value.phase !== own.phase || value.specialty !== own.specialty || value.manifestSha256 !== options.manifestSha256 || !same(value.file, initial) || !same(value.directory, own.directoryId) || initial.size !== line.length) failure();
    return line;
  });
  const fileId = id(initial); let sequence = 0, size = header.length, stopped = false;
  return {
    record(stage, state) {
      try {
        guard(); if (stopped || !nativeProgressStages.includes(stage)) failure();
        const keys = ['owners', 'registeredPids', 'confirmedOwners', 'readyOwners', 'closedOwners'];
        if (Object.keys(state).sort().join() !== [...keys, 'pids', 'retained', 'removed'].sort().join() || keys.some(key => !Number.isSafeInteger(state[key]) || state[key] < 0) || !Array.isArray(state.pids) || state.pids.length > 4096 || new Set(state.pids).size !== state.pids.length || state.pids.some(value => !Number.isSafeInteger(value) || value <= 0) || state.registeredPids !== state.pids.length || typeof state.retained !== 'boolean' || typeof state.removed !== 'boolean') failure();
        if (!same(regular(own.directory, true), own.directoryId) || !same(regular(own.path), fileId)) failure();
        handle(own.path, 'read', fileId, (fd, stat, read) => {
          if (stat.size !== size) failure(); const bytes = read(() => io.header(fd)); if (!bytes.subarray(0, header.length).equals(header)) failure();
        });
        const bytes = Buffer.from(JSON.stringify({ sequence: sequence + 1, stage, ...state }) + '\n');
        handle(own.path, 'append', fileId, (fd, stat, write) => {
          if (stat.size !== size || size + bytes.length > 1024 * 1024) failure();
          if (write(() => io.append(fd, bytes)) !== bytes.length) throw Error('原生阶段诊断未完整追加');
        });
        sequence++; size += bytes.length; checked(() => io.stat(own.path));
      } catch (error) { stopped = true; throw error; }
    },
  };
}
