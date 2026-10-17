import { inspect } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseBackupSecretFile, DatabaseBackupSecretFileOwners, type DatabaseBackupSecretAcl, type DatabaseBackupSecretDirectory, type DatabaseBackupSecretFileHandle, type DatabaseBackupSecretFilePorts, type DatabaseBackupSecretStamp } from '../../src/engine/databaseBackupSecretFile';

/** 端口全部为RAM假句柄，不调用fs、OS、ACL程序或真实凭据来源。 */
function fixture(platform: 'posix' | 'win32' = 'posix') {
  const owner = { taskId: 'fixture-original-task', planToken: 'fixture-original-plan' }, owners = new DatabaseBackupSecretFileOwners();
  const sid = 'S-1-5-21-111-222-333-1001', order: string[] = [], copies: Buffer[] = [], buffers: Uint8Array[] = [];
  let cancelled = false;
  const stamp = (identity: string, kind: 'directory' | 'file'): DatabaseBackupSecretStamp => ({ identity, entryIdentity: identity, kind, unsafeLink: false, uid: 1000, mode: kind === 'directory' ? 0o700 : 0o600 });
  const parentStamp = stamp('parent-identity', 'directory'), directoryStamp = stamp('directory-identity', 'directory'), fileStamp = stamp('file-identity', 'file');
  const file: DatabaseBackupSecretFileHandle = {
    inspect: vi.fn(async () => ({ ...fileStamp })),
    write: vi.fn(async (bytes, offset, length, position) => { expect(position).toBe(offset); expect(length).toBeLessThanOrEqual(65536); const count = Math.min(3, length); order.push('写'); buffers.push(bytes); copies.push(Buffer.from(bytes.subarray(offset, offset + count))); return count; }),
    sync: vi.fn(async () => { order.push('sync'); }), close: vi.fn(async () => { order.push('文件close'); }),
  };
  const directory: DatabaseBackupSecretDirectory = {
    inspect: vi.fn(async () => ({ ...directoryStamp })), createDirectory: vi.fn(async () => { throw Error('不得在子目录再次分配'); }),
    openFile: vi.fn(async (name, options) => { expect(name).toBe('client.cnf'); expect(options).toEqual({ flags: 'wx', mode: 0o600 }); order.push('wx'); return file; }),
    inspectFile: vi.fn(async name => { expect(name).toBe('client.cnf'); return { ...fileStamp }; }),
    removeFile: vi.fn(async (name, identity) => { expect(name).toBe('client.cnf'); order.push('unlink'); return { identity, removed: true as const }; }),
    removeEmptyDirectory: vi.fn(async () => { throw Error('不得删除其他目录'); }), close: vi.fn(async () => { order.push('子目录close'); }),
  };
  const parent: DatabaseBackupSecretDirectory = {
    inspect: vi.fn(async () => ({ ...parentStamp })), createDirectory: vi.fn(async (name, mode) => { expect(name).toBe('dbark-private-fixture'); expect(mode).toBe(0o700); order.push('mkdir'); return directory; }),
    openFile: vi.fn(async () => { throw Error('父目录不能直接放凭据'); }), inspectFile: vi.fn(async () => { throw Error('父目录不得扫描其他文件'); }),
    removeFile: vi.fn(async () => { throw Error('父目录不得删除文件'); }), removeEmptyDirectory: vi.fn(async (name, identity) => { expect(name).toBe('dbark-private-fixture'); order.push('rmdir-empty'); return { identity, removed: true as const }; }), close: vi.fn(async () => { order.push('父目录close'); }),
  };
  const acl = (identity: string, isDirectory: boolean): DatabaseBackupSecretAcl => ({ identity, ownerSid: sid, inheritanceDisabled: true, aces: [sid, 'S-1-5-18'].map(sid => ({ sid, allow: true, inherited: false, fullControl: true, containerInherit: isDirectory, objectInherit: isDirectory })) });
  const ports: DatabaseBackupSecretFilePorts = {
    openParent: vi.fn(async () => { order.push('父目录open'); return parent; }),
    cleanupPermit: vi.fn(async () => ({ owner, originalOperationLeft: true as const, nativeClosed: true as const, streamsClosed: true as const })),
    checkCancelled() { if (cancelled) throw Error('仅合成取消'); },
    windows: { readDirectory: vi.fn(async () => { order.push('父ACL'); return acl(parentStamp.identity, true); }), protectDirectory: vi.fn(async () => { order.push('目录ACL'); return acl(directoryStamp.identity, true); }), protectFile: vi.fn(async () => { order.push('文件ACL'); return acl(fileStamp.identity, false); }) },
  };
  const config = { platform, parentDirectory: platform === 'posix' ? '/private-fixture-base' : 'D:\\Private Fixture Base', directoryName: 'dbark-private-fixture', uid: 1000, currentUserSid: sid };
  const secret = new DatabaseBackupSecretFile(owner, config, ports, owners);
  const text = '[client]\nuser="fixture"\npassword="SYNTHETIC-secret-only"\n', source = { takeText: vi.fn(() => { order.push('取文本'); return text; }) };
  return { owner, owners, parent, directory, file, parentStamp, directoryStamp, fileStamp, ports, secret, config, source, text, order, copies, buffers, acl, cancel() { cancelled = true; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('B01敏感临时文件所有权与真实端口协议（仅RAM）', () => {
  it('构造同步登记槽位且不分配资源；同任务号永久占位，重复构造使原owner停链', async () => {
    const f = fixture(); expect(f.ports.openParent).not.toHaveBeenCalled(); expect(f.secret.snapshot()).toMatchObject({ slot: 1, started: false, parentAllocated: false, fileAllocated: false, closed: false });
    expect(() => new DatabaseBackupSecretFile({ ...f.owner }, f.config, f.ports, f.owners)).toThrow('归属');
    await expect(f.secret.open(f.source)).rejects.toThrow('归属'); expect(f.source.takeText).not.toHaveBeenCalled(); expect(f.secret.snapshot().poisoned).toBe(true);
  });
  it('POSIX先验证0700/0600与uid，再完整短写/sync/close；RAM字节清零，路径仅私有getter返回', async () => {
    const f = fixture(); await f.secret.open(f.source);
    expect(Buffer.concat(f.copies).toString('utf8')).toBe(f.text); expect(f.file.write).toHaveBeenCalledTimes(Math.ceil(Buffer.byteLength(f.text) / 3));
    expect(f.file.sync).toHaveBeenCalledTimes(1); expect(f.file.close).toHaveBeenCalledTimes(1); expect(f.order.slice(-2)).toEqual(['sync', '文件close']);
    expect(f.source.takeText).toHaveBeenCalledTimes(1); expect(f.buffers.every(bytes => bytes.every(value => value === 0))).toBe(true);
    expect(f.secret.privateClientPath()).toBe('/private-fixture-base/dbark-private-fixture/client.cnf'); expect(f.secret.snapshot()).toMatchObject({ ready: true, fileClosed: true, closed: false });
    await expect(f.secret.open(f.source)).rejects.toThrow('状态'); expect(f.source.takeText).toHaveBeenCalledTimes(1);
  });
  it('Windows必须先取得父/目录/文件ACL读回证明，chmod位不能代替它', async () => {
    const f = fixture('win32'); await f.secret.open(f.source);
    expect(f.order.indexOf('父ACL')).toBeLessThan(f.order.indexOf('mkdir')); expect(f.order.indexOf('目录ACL')).toBeLessThan(f.order.indexOf('wx'));
    expect(f.order.indexOf('文件ACL')).toBeLessThan(f.order.indexOf('取文本')); expect(f.secret.privateClientPath()).toBe('D:\\Private Fixture Base\\dbark-private-fixture\\client.cnf');
    const missing = fixture('win32'); missing.ports.windows = undefined; await expect(missing.secret.open(missing.source)).rejects.toThrow('权限');
    expect(missing.ports.openParent).not.toHaveBeenCalled(); expect(missing.source.takeText).not.toHaveBeenCalled();
  });
  it('不能把父目录或其他已持有的句柄当作新资源，禁止别名双重关闭', async () => {
    const f = fixture(); vi.mocked(f.parent.createDirectory).mockResolvedValue(f.parent);
    await expect(f.secret.open(f.source)).rejects.toThrow('已保留'); expect(f.source.takeText).not.toHaveBeenCalled();
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.secret.snapshot().allocationUnknown).toBe(true); expect(f.parent.close).not.toHaveBeenCalled();
  });
  it.each(['继承未关闭', 'Owner错误', '多余SID', '继承ACE', '拒绝ACE', '非完整控制', '目录不继承子项', '身份错误'] as const)('Windows %s 时不消费文本、不写秘密', async fault => {
    const f = fixture('win32'), proof = f.acl(f.directoryStamp.identity, true);
    switch (fault) {
      case '继承未关闭': Object.assign(proof, { inheritanceDisabled: false }); break;
      case 'Owner错误': proof.ownerSid = 'S-1-5-18'; break;
      case '多余SID': proof.aces = [...proof.aces, { ...proof.aces[0], sid: 'S-1-1-0' }]; break;
      case '继承ACE': Object.assign(proof.aces[0], { inherited: true }); break;
      case '拒绝ACE': Object.assign(proof.aces[0], { allow: false }); break;
      case '非完整控制': Object.assign(proof.aces[0], { fullControl: false }); break;
      case '目录不继承子项': proof.aces[0].objectInherit = false; break;
      case '身份错误': proof.identity = '另一个目录'; break;
    }
    vi.mocked(f.ports.windows!.protectDirectory).mockResolvedValue(proof);
    await expect(f.secret.open(f.source)).rejects.toThrow('权限'); expect(f.source.takeText).not.toHaveBeenCalled(); expect(f.file.write).not.toHaveBeenCalled();
  });
  it('文件ACL错误也在取文本之前阻断', async () => {
    const f = fixture('win32'), proof = f.acl(f.fileStamp.identity, false); proof.aces[0].containerInherit = true;
    vi.mocked(f.ports.windows!.protectFile).mockResolvedValue(proof); await expect(f.secret.open(f.source)).rejects.toThrow('权限'); expect(f.source.takeText).not.toHaveBeenCalled();
  });
  it('POSIX uid、mode、链接、具名入口换绑均阻断，不能只检查原句柄', async () => {
    for (const patch of [{ uid: 0 }, { mode: 0o755 }, { unsafeLink: true }, { entryIdentity: 'foreign-entry' }, { kind: 'other' }]) {
      const f = fixture(); Object.assign(f.directoryStamp, patch); await expect(f.secret.open(f.source)).rejects.toThrow('权限'); expect(f.source.takeText).not.toHaveBeenCalled();
    }
    const f = fixture(); f.fileStamp.mode = 0o644; await expect(f.secret.open(f.source)).rejects.toThrow('权限'); expect(f.source.takeText).not.toHaveBeenCalled();
  });
  it.each(['父目录', '子目录', '文件'] as const)('%s异步迟到后先捕获原句柄；在途cleanup不代替原操作离开', async kind => {
    const f = fixture(), arrived = deferred<void>(); let release!: () => void;
    if (kind === '父目录') { const gate = deferred<DatabaseBackupSecretDirectory>(); vi.mocked(f.ports.openParent).mockImplementation(() => { arrived.resolve(); return gate.promise; }); release = () => gate.resolve(f.parent); }
    else if (kind === '子目录') { const gate = deferred<DatabaseBackupSecretDirectory>(); vi.mocked(f.parent.createDirectory).mockImplementation(() => { arrived.resolve(); return gate.promise; }); release = () => gate.resolve(f.directory); }
    else { const gate = deferred<DatabaseBackupSecretFileHandle>(); vi.mocked(f.directory.openFile).mockImplementation(() => { arrived.resolve(); return gate.promise; }); release = () => gate.resolve(f.file); }
    const opening = f.secret.open(f.source), rejected = expect(opening).rejects.toThrow('已保留'); await arrived.promise; f.cancel();
    expect(f.secret.snapshot()).toMatchObject({ active: true, pending: 1 }); expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.ports.cleanupPermit).not.toHaveBeenCalled();
    release(); await rejected; expect(f.source.takeText).not.toHaveBeenCalled(); expect(f.file.close).not.toHaveBeenCalled(); expect(f.directory.removeFile).not.toHaveBeenCalled();
    expect(f.secret.snapshot()[kind === '父目录' ? 'parentAllocated' : kind === '子目录' ? 'directoryAllocated' : 'fileAllocated']).toBe(true);
    expect((await f.secret.cleanup()).state).toBe('confirmed'); expect(f.secret.snapshot().closed).toBe(true);
    if (kind === '文件') expect(f.file.close).toHaveBeenCalledTimes(1);
  });
  it('取消中在途写入保留缓冲和原句柄，晚到后清零RAM但不在finally关闭文件', async () => {
    const f = fixture(), arrived = deferred<void>(), gate = deferred<number>(); let reference!: Uint8Array;
    vi.mocked(f.file.write).mockImplementation((bytes, _offset, length) => { reference = bytes; arrived.resolve(); return gate.promise; });
    const pending = f.secret.open(f.source), rejected = expect(pending).rejects.toThrow('已保留'); await arrived.promise; f.cancel();
    expect(reference.some(byte => byte !== 0)).toBe(true); expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.file.close).not.toHaveBeenCalled();
    gate.resolve(reference.length); await rejected; expect(reference.every(byte => byte === 0)).toBe(true); expect(f.file.close).not.toHaveBeenCalled();
    expect((await f.secret.cleanup()).state).toBe('confirmed'); expect(f.file.close).toHaveBeenCalledTimes(1);
  });
  it('ready后取消也不能再取得工具路径，只有Root真实终态许可可清理', async () => {
    const f = fixture(); await f.secret.open(f.source); f.cancel(); expect(() => f.secret.privateClientPath()).toThrow('已保留');
    expect(f.secret.snapshot().ready).toBe(false); expect((await f.secret.cleanup()).state).toBe('confirmed');
  });
  it('迟到close的真实成功会记录，但取消不变成ready，清理不二次close', async () => {
    const f = fixture(), arrived = deferred<void>(), gate = deferred<void>();
    vi.mocked(f.file.close).mockImplementation(() => { arrived.resolve(); return gate.promise; });
    const pending = f.secret.open(f.source), rejected = expect(pending).rejects.toThrow('已保留'); await arrived.promise; f.cancel();
    expect((await f.secret.cleanup()).state).toBe('unknown'); gate.resolve(); await rejected;
    expect(f.secret.snapshot()).toMatchObject({ fileClosed: true, ready: false }); expect((await f.secret.cleanup()).state).toBe('confirmed'); expect(f.file.close).toHaveBeenCalledTimes(1);
  });
  it('64KiB文本预算、NUL和不可编码文本拒绝；没有截断或再次消费', async () => {
    for (const text of ['[client]\n' + 'x'.repeat(65536), '[client]\npassword="a\0b"\n', '[client]\npassword="\ud800"\n']) {
      const f = fixture(); f.source.takeText.mockReturnValue(text); await expect(f.secret.open(f.source)).rejects.toThrow('已保留'); expect(f.file.write).not.toHaveBeenCalled(); expect(f.source.takeText).toHaveBeenCalledTimes(1);
    }
    const f = fixture(), text = '[client]\n' + 'x'.repeat(65536 - 9); f.source.takeText.mockReturnValue(text);
    vi.mocked(f.file.write).mockImplementation(async (bytes, _offset, length) => { f.buffers.push(bytes); return length; });
    await f.secret.open(f.source); expect(f.secret.snapshot().bytesWritten).toBe(65536); expect(f.buffers[0].every(byte => byte === 0)).toBe(true);
  });
  it('无效短写和sync失败保留句柄且清零，不自动close/unlink', async () => {
    for (const count of [0, -1, NaN, 65537]) {
      const f = fixture(); vi.mocked(f.file.write).mockImplementation(async bytes => { f.buffers.push(bytes); return count; }); await expect(f.secret.open(f.source)).rejects.toThrow('已保留');
      expect(f.buffers[0].every(byte => byte === 0)).toBe(true); expect(f.file.close).not.toHaveBeenCalled(); expect(f.directory.removeFile).not.toHaveBeenCalled();
    }
    const f = fixture(); vi.mocked(f.file.sync).mockRejectedValue(Error('SYNTHETIC敏感驱动原文')); await expect(f.secret.open(f.source)).rejects.toThrow('已保留'); expect(f.file.close).not.toHaveBeenCalled();
    expect((await f.secret.cleanup()).state).toBe('confirmed');
  });
  it('open拒绝不能证明未分配：未知槽位不重新open、不补删、不虚报closed', async () => {
    const f = fixture(); vi.mocked(f.directory.openFile).mockRejectedValue(Error('可能已分配但未回执'));
    await expect(f.secret.open(f.source)).rejects.toThrow('已保留'); expect(f.secret.snapshot()).toMatchObject({ allocationUnknown: true, fileStarted: true, closed: false });
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect((await f.secret.cleanup()).state).toBe('unknown');
    expect(f.directory.openFile).toHaveBeenCalledTimes(1); expect(f.directory.removeFile).not.toHaveBeenCalled(); expect(f.parent.createDirectory).toHaveBeenCalledTimes(1);
  });
  it('只有同owner的操作离开/进程/流全确认许可才能清理，cancel ACK不能代替', async () => {
    for (const patch of [{ originalOperationLeft: false }, { nativeClosed: false }, { streamsClosed: false }, { owner: { ...fixture().owner } }, { cancelAcknowledged: true, nativeClosed: undefined }]) {
      const f = fixture(); await f.secret.open(f.source); vi.mocked(f.ports.cleanupPermit).mockResolvedValue(Object.assign({ owner: f.owner, originalOperationLeft: true, nativeClosed: true, streamsClosed: true }, patch) as never);
      expect((await f.secret.cleanup()).state).toBe('unknown'); expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.ports.cleanupPermit).toHaveBeenCalledTimes(1); expect(f.directory.removeFile).not.toHaveBeenCalled();
    }
  });
  it('正常cleanup只删本次wx文件和独占空目录，关闭顺序与幂等回执明确', async () => {
    const f = fixture(); await f.secret.open(f.source); const first = f.secret.cleanup(), second = f.secret.cleanup(); expect(first).toBe(second);
    expect((await first).state).toBe('confirmed'); expect(f.order.slice(-4)).toEqual(['unlink', '子目录close', 'rmdir-empty', '父目录close']);
    expect(f.directory.removeFile).toHaveBeenCalledWith('client.cnf', 'file-identity'); expect(f.parent.removeEmptyDirectory).toHaveBeenCalledWith('dbark-private-fixture', 'directory-identity');
    expect(f.file.close).toHaveBeenCalledTimes(1); expect((await f.secret.cleanup()).state).toBe('confirmed'); expect(f.directory.removeFile).toHaveBeenCalledTimes(1); expect(() => f.secret.privateClientPath()).toThrow('已保留');
  });
  it.each(['文件', '目录', '父目录'] as const)('%sclose未知后不重新关闭、不继续删除未知资源', async kind => {
    const f = fixture(); const handle = kind === '文件' ? f.file : kind === '目录' ? f.directory : f.parent;
    vi.mocked(handle.close).mockRejectedValue(Error('关闭未确认'));
    if (kind === '文件') await expect(f.secret.open(f.source)).rejects.toThrow('已保留'); else await f.secret.open(f.source);
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect((await f.secret.cleanup()).state).toBe('unknown'); expect(handle.close).toHaveBeenCalledTimes(1); expect(f.secret.snapshot()).toMatchObject({ closeUnknown: true, closed: false });
    if (kind === '文件') expect(f.directory.removeFile).not.toHaveBeenCalled();
  });
  it('文件或目录身份换绑/链接不能删除新入口；失败回执不重试', async () => {
    for (const target of ['文件', '目录', '父目录']) {
      const f = fixture(); await f.secret.open(f.source); const stamp = target === '文件' ? f.fileStamp : target === '目录' ? f.directoryStamp : f.parentStamp;
      stamp.entryIdentity = '他人新入口'; expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.directory.removeFile).not.toHaveBeenCalled(); expect(f.parent.removeEmptyDirectory).not.toHaveBeenCalled();
    }
    const f = fixture(); await f.secret.open(f.source); vi.mocked(f.directory.removeFile).mockResolvedValue({ identity: '错误回执', removed: true });
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.directory.removeFile).toHaveBeenCalledTimes(1); expect(f.parent.removeEmptyDirectory).not.toHaveBeenCalled();
  });
  it('目录非空时不递归或重新分配；原清理Promise保留失败', async () => {
    const f = fixture(); await f.secret.open(f.source); vi.mocked(f.parent.removeEmptyDirectory).mockRejectedValue(Error('ENOTEMPTY'));
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.parent.removeEmptyDirectory).toHaveBeenCalledTimes(1); expect(f.parent.close).not.toHaveBeenCalled();
  });
  it('owner换绑再改回原编号仍停链；快照及日志仅有白名单数字/布尔', async () => {
    const f = fixture(); await f.secret.open(f.source); f.owner.taskId = 'changed'; expect(() => f.secret.privateClientPath()).toThrow('归属'); f.owner.taskId = 'fixture-original-task';
    expect((await f.secret.cleanup()).state).toBe('unknown'); expect(f.secret.snapshot().poisoned).toBe(true); expect(f.directory.removeFile).not.toHaveBeenCalled();
    for (const value of Object.values(f.secret.snapshot())) expect(['number', 'boolean']).toContain(typeof value);
    for (const text of [JSON.stringify(f.secret), inspect(f.secret), inspect(f.secret, { customInspect: false, showHidden: true })]) {
      for (const hidden of [f.text, 'SYNTHETIC-secret-only', f.config.parentDirectory, f.owner.taskId, f.owner.planToken]) expect(text).not.toContain(hidden);
    }
  });
});
