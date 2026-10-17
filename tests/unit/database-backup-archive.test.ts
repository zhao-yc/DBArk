import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseBackupArchiveWriter, inspectDatabaseBackupArchive, databaseBackupArchiveLimits as limits, type DatabaseBackupArchiveManifestInput, type DatabaseBackupArchiveReader } from '../../src/engine/databaseBackupArchive';
import { queryZipDirectory, queryZipEnd } from '../../src/engine/queryCsvZip';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** 清单中的锁/资源均为外部声明；字节完整性测试不把它们当作真实数据库证明。 */
function manifest(): DatabaseBackupArchiveManifestInput {
  return { format: 'dbark-backup-zip-store-v1', schemaVersion: 1, family: 'mysql', serverVersion: '8.4.0', toolVersion: '8.4.0', toolSuiteSha256: 'a'.repeat(64), toolRegistryRevision: 'fixture-v1', database: '测试库', objects: [{ kind: 'table', name: '原字节表', definitionSha256: 'b'.repeat(64), engine: 'InnoDB' }], consistency: { profileId: 'fixture-lock', acquiredAt: '2026-10-17T10:00:00Z', completedAt: '2026-10-17T10:00:01Z', allObjectsFrozen: false }, externalDependencies: [], resourcesConfirmed: false, restoreVerified: false };
}
/** RAM端口只保存小夹具；不创建文件、不提交原子文件、不运行数据库或OS程序。 */
async function archive(sql = Buffer.from('SELECT 1;\r\n'), input = manifest()) {
  const chunks: Buffer[] = [], sink = { writeBytes: vi.fn(async (bytes: Uint8Array) => { chunks.push(Buffer.from(bytes)); }) };
  const writer = new DatabaseBackupArchiveWriter(sink);
  await writer.startDump();
  for (let at = 0; at < sql.length; at += 137) await writer.writeDump(sql.subarray(at, at + 137));
  const result = await writer.finish(input);
  return { bytes: Buffer.concat(chunks), result, sink, writer };
}
function reader(bytes: Buffer, short = limits.blockBytes): DatabaseBackupArchiveReader {
  return { size: BigInt(bytes.length), async read(offset, length) { expect(length).toBeLessThanOrEqual(limits.blockBytes); expect(typeof offset).toBe('bigint'); return bytes.subarray(Number(offset), Number(offset) + Math.min(length, short)); } };
}
/** 攻击夹具用逐位参考CRC重写元数据，避免测试只因旧CRC失配就提前成功。 */
function referenceCrc(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}
/** 独立重组两个条目的payload，可制造CRC合法但清单/摘要非法的容器。 */
function repack(original: Buffer, dump: Buffer, json: Buffer): Buffer {
  const oldDumpSize = Number(original.readBigUInt64LE(original.length - 98 - 169 + 46 + 8 + 4));
  const dumpHeader = original.subarray(0, 58), manifestHeader = original.subarray(58 + oldDumpSize + 24, 58 + oldDumpSize + 24 + 63);
  const entries = [{ name: 'dump.sql', offset: 0, bytes: dump.length, crc: referenceCrc(dump) }, { name: 'manifest.json', offset: 58 + dump.length + 24, bytes: json.length, crc: referenceCrc(json) }];
  const descriptor = (entry: typeof entries[number]) => { const out = Buffer.alloc(24); out.writeUInt32LE(0x08074b50); out.writeUInt32LE(entry.crc, 4); out.writeBigUInt64LE(BigInt(entry.bytes), 8); out.writeBigUInt64LE(BigInt(entry.bytes), 16); return out; };
  const body = Buffer.concat([dumpHeader, dump, descriptor(entries[0]), manifestHeader, json, descriptor(entries[1])]);
  const directory = Buffer.concat(entries.map(queryZipDirectory));
  return Buffer.concat([body, directory, queryZipEnd(2, body.length, directory.length)]);
}
function payloads(bytes: Buffer) {
  const central = bytes.length - 98 - 169, dumpSize = Number(bytes.readBigUInt64LE(central + 58));
  const jsonSize = Number(bytes.readBigUInt64LE(central + 82 + 63));
  return { central, dump: Buffer.from(bytes.subarray(58, 58 + dumpSize)), json: Buffer.from(bytes.subarray(58 + dumpSize + 24 + 63, 58 + dumpSize + 24 + 63 + jsonSize)) };
}

describe('B01顺序归档writer与严格inspect（纯RAM）', () => {
  it('大整数、二进制、DELIMITER与换行逐字节保留，整包SHA实算一致，允许短读', async () => {
    const sql = Buffer.concat([Buffer.from('INSERT INTO t VALUES(18446744073709551615,0x00FF);\r\nDELIMITER $$\n'), Buffer.from([0, 255, 0x80]), Buffer.from('\nCREATE PROCEDURE p() SELECT 1$$\nDELIMITER ;\n'), Buffer.alloc(70000, 0x61)]);
    const value = await archive(sql), found = await inspectDatabaseBackupArchive(reader(value.bytes, 997));
    expect(value.bytes.subarray(58, 58 + sql.length)).toEqual(sql);
    expect(found.dump).toEqual({ entry: 'dump.sql', bytes: String(sql.length), sha256: sha(sql) });
    expect(found.archive).toEqual({ bytes: String(value.bytes.length), sha256: sha(value.bytes) });
    expect(found.archive).toEqual(value.result.archive); expect(found.manifest).toEqual(value.result.manifest);
    expect(found).toMatchObject({ integrity: 'valid', restoreVerified: false });
    expect(found.manifest.resourcesConfirmed).toBe(false); expect(found.manifest.consistency.allObjectsFrozen).toBe(false);
    expect(value.sink.writeBytes.mock.calls.every(([bytes]) => bytes.length <= limits.blockBytes)).toBe(true);
  });
  it('空dump仍须有完整CRC、SHA和两个条目', async () => {
    const value = await archive(Buffer.alloc(0));
    expect((await inspectDatabaseBackupArchive(reader(value.bytes, 7))).dump.sha256).toBe(sha(Buffer.alloc(0)));
  });
  it('背压期间不读取下一片，输入副本不会被调用方改写', async () => {
    const chunks: Buffer[] = []; let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), arrived = new Promise<void>(resolve => { entered = resolve; });
    const writer = new DatabaseBackupArchiveWriter({ async writeBytes(bytes) { if (chunks.length === 1) { entered(); await gate; } chunks.push(Buffer.from(bytes)); } });
    await writer.startDump(); const input = Buffer.from('原始内容'), expected = Buffer.from(input);
    let finished = false; const pending = writer.writeDump(input).then(() => { finished = true; }); await arrived;
    input.fill(0); expect(finished).toBe(false); expect(chunks).toHaveLength(1); release(); await pending;
    const result = await writer.finish(manifest()); expect(result.dump.sha256).toBe(sha(expected)); expect(chunks[1]).toEqual(expected);
  });
  it('并发调用永久停链，在途写完成后也不能继续finish', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const sink = { writeBytes: vi.fn(async () => { await gate; }) }, writer = new DatabaseBackupArchiveWriter(sink);
    const pending = writer.startDump(); const failed = expect(pending).rejects.toThrow('停链');
    await expect(writer.writeDump(Buffer.from('x'))).rejects.toThrow('状态'); release(); await failed;
    await expect(writer.finish(manifest())).rejects.toThrow('状态'); expect(sink.writeBytes).toHaveBeenCalledTimes(1);
  });
  it('sink失败、取消和超大片段后均永久停链', async () => {
    const sink = { writeBytes: vi.fn(async () => {}) }; let cancelled = false;
    const writer = new DatabaseBackupArchiveWriter(sink, () => { if (cancelled) throw Error('已取消'); }); await writer.startDump(); cancelled = true;
    await expect(writer.writeDump(Buffer.from('x'))).rejects.toThrow('已取消'); cancelled = false;
    await expect(writer.finish(manifest())).rejects.toThrow('状态'); expect(sink.writeBytes).toHaveBeenCalledTimes(1);
    const failedSink = { writeBytes: vi.fn(async () => { throw Error('短写失败'); }) }, bad = new DatabaseBackupArchiveWriter(failedSink);
    await expect(bad.startDump()).rejects.toThrow('短写失败'); await expect(bad.startDump()).rejects.toThrow('状态'); expect(failedSink.writeBytes).toHaveBeenCalledTimes(1);
    const large = new DatabaseBackupArchiveWriter(sink); await large.startDump(); await expect(large.writeDump(Buffer.alloc(limits.blockBytes + 1))).rejects.toThrow('片段');
    await expect(large.finish(manifest())).rejects.toThrow('状态');
  });
  it('等待sink后发生取消，不能误报finish成功', async () => {
    let cancelled = false; const sink = { writeBytes: vi.fn(async () => { cancelled = true; }) };
    const writer = new DatabaseBackupArchiveWriter(sink, () => { if (cancelled) throw Error('已取消'); });
    await expect(writer.startDump()).rejects.toThrow('已取消'); cancelled = false;
    await expect(writer.finish(manifest())).rejects.toThrow('状态'); expect(sink.writeBytes).toHaveBeenCalledTimes(1);
  });
  it('显式dump声明必须匹配，不允许未知字段或恢复成功声明', async () => {
    await expect(archive(Buffer.from('x'), { ...manifest(), dump: { entry: 'dump.sql', bytes: '1', sha256: '0'.repeat(64) } })).rejects.toThrow('声明');
    for (const input of [{ ...manifest(), unknown: true }, { ...manifest(), restoreVerified: true }, { ...manifest(), format: 'zip-v2' }, { ...manifest(), family: ['mysql'] }, { ...manifest(), objects: [{ ...manifest().objects[0], kind: ['table'] }] }, { ...manifest(), objects: [{ ...manifest().objects[0], unknown: true }] }]) {
      await expect(archive(Buffer.alloc(0), input as unknown as DatabaseBackupArchiveManifestInput)).rejects.toThrow('清单');
    }
  });
  it('清单验证拒绝getter/toJSON、重复对象、循环及超过2MiB输入', async () => {
    const getter = vi.fn(() => 'mysql'), call = vi.fn(() => ({}));
    const evil = manifest(); Object.defineProperty(evil, 'family', { get: getter, enumerable: true });
    await expect(archive(Buffer.alloc(0), evil)).rejects.toThrow('清单'); expect(getter).not.toHaveBeenCalled();
    await expect(archive(Buffer.alloc(0), { ...manifest(), toJSON: call } as DatabaseBackupArchiveManifestInput)).rejects.toThrow('清单'); expect(call).not.toHaveBeenCalled();
    const cycle = manifest(); (cycle.externalDependencies as unknown as unknown[]).push(cycle);
    await expect(archive(Buffer.alloc(0), cycle)).rejects.toThrow('清单');
    await expect(archive(Buffer.alloc(0), { ...manifest(), objects: [manifest().objects[0], manifest().objects[0]] })).rejects.toThrow('清单');
    await expect(archive(Buffer.alloc(0), { ...manifest(), externalDependencies: Array(1100).fill('x'.repeat(2048)) })).rejects.toThrow('预算');
  });
  it('实际dump字节损坏由CRC阻断；CRC全部重算后仍须通过SHA', async () => {
    const value = await archive(), altered = Buffer.from(value.bytes); altered[58] ^= 1;
    await expect(inspectDatabaseBackupArchive(reader(altered))).rejects.toThrow('CRC');
    const data = payloads(value.bytes); data.dump[0] ^= 1;
    await expect(inspectDatabaseBackupArchive(reader(repack(value.bytes, data.dump, data.json)))).rejects.toThrow('SHA');
  });
  it('CRC合法的未知清单、重复JSON键、非法UTF8与非规范JSON仍被阻断', async () => {
    const value = await archive(), data = payloads(value.bytes), text = data.json.toString('utf8');
    const bad = [Buffer.from(text.replace('"family":"mysql"', '"family":["mysql"]')), Buffer.from(text.replace('"kind":"table"', '"kind":["table"]')), Buffer.from(text.replace('"schemaVersion":1', '"schemaVersion":2')), Buffer.from(text.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')), Buffer.from(' ' + text), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), data.json]), Buffer.concat([data.json.subarray(0, -1), Buffer.from([0xff, 125])])];
    for (const json of bad) await expect(inspectDatabaseBackupArchive(reader(repack(value.bytes, data.dump, json)))).rejects.toThrow('清单');
  });
  it('空短读、超额返回、截断、读取消和读取中大小变化均阻断', async () => {
    const value = await archive();
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(99)]) await expect(inspectDatabaseBackupArchive({ size: BigInt(value.bytes.length), read: async () => bytes })).rejects.toThrow();
    await expect(inspectDatabaseBackupArchive(reader(value.bytes.subarray(0, -1)))).rejects.toThrow();
    let cancelled = false;
    await expect(inspectDatabaseBackupArchive({ size: BigInt(value.bytes.length), async read(offset, length) { cancelled = true; return value.bytes.subarray(Number(offset), Number(offset) + length); } }, () => { if (cancelled) throw Error('读取已取消'); })).rejects.toThrow('已取消');
    let reads = 0;
    await expect(inspectDatabaseBackupArchive({ get size() { return BigInt(value.bytes.length + (reads ? 1 : 0)); }, async read(offset, length) { reads++; return value.bytes.subarray(Number(offset), Number(offset) + length); } })).rejects.toThrow('大小变化');
  });
  it('总大小超10GiB、清单声明超2MiB和恶意uint64偏移先预算拒绝', async () => {
    const read = vi.fn(); await expect(inspectDatabaseBackupArchive({ size: limits.archiveBytes + 1n, read })).rejects.toThrow('预算'); expect(read).not.toHaveBeenCalled();
    const value = await archive(), central = payloads(value.bytes).central;
    const oversized = Buffer.from(value.bytes); oversized.writeBigUInt64LE(BigInt(limits.manifestBytes + 1), central + 82 + 63); oversized.writeBigUInt64LE(BigInt(limits.manifestBytes + 1), central + 82 + 71);
    await expect(inspectDatabaseBackupArchive(reader(oversized))).rejects.toThrow('预算');
    const offset = Buffer.from(value.bytes); offset.writeBigUInt64LE(0xffffffffffffffffn, central + 74);
    await expect(inspectDatabaseBackupArchive(reader(offset))).rejects.toThrow('预算');
  });
  it.each(['路径名', '重复名字', '目录方法', '目录flag', '本地方法', '本地flag', '本地ZIP64', '无签名描述符', '描述符大小', '偏移重叠', '偏移间隙', '条数三', '伪ZIP64', '定位器', '尾部注释', '中央CRC', '尾部附加字节'] as const)('%s破坏严格容器边界时拒绝', async kind => {
    const value = await archive(), bytes = Buffer.from(value.bytes), { central, dump } = payloads(bytes), tail = bytes.length - 98;
    switch (kind) {
      case '路径名': Buffer.from('../x.sql').copy(bytes, 30); Buffer.from('../x.sql').copy(bytes, central + 46); break;
      case '重复名字': Buffer.from('dump.sql').copy(bytes, central + 82 + 46); break;
      case '目录方法': bytes.writeUInt16LE(8, central + 10); break;
      case '目录flag': bytes.writeUInt16LE(1, central + 8); break;
      case '本地方法': bytes.writeUInt16LE(8, 8); break;
      case '本地flag': bytes.writeUInt16LE(1, 6); break;
      case '本地ZIP64': bytes.writeUInt16LE(2, 38); break;
      case '无签名描述符': bytes.writeUInt32LE(0, 58 + dump.length); break;
      case '描述符大小': bytes.writeBigUInt64LE(1n, 58 + dump.length + 8); break;
      case '偏移重叠': bytes.writeBigUInt64LE(1n, central + 82 + 79); break;
      case '偏移间隙': bytes.writeBigUInt64LE(BigInt(58 + dump.length + 25), central + 82 + 79); break;
      case '条数三': bytes.writeBigUInt64LE(3n, tail + 24); break;
      case '伪ZIP64': bytes.writeBigUInt64LE(0xffffffffffffffffn, tail + 4); break;
      case '定位器': bytes.writeBigUInt64LE(0n, tail + 64); break;
      case '尾部注释': bytes.writeUInt16LE(1, bytes.length - 2); break;
      case '中央CRC': bytes.writeUInt32LE((bytes.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16); break;
      case '尾部附加字节': await expect(inspectDatabaseBackupArchive(reader(Buffer.concat([bytes, Buffer.from('x')])))).rejects.toThrow(); return;
    }
    await expect(inspectDatabaseBackupArchive(reader(bytes))).rejects.toThrow();
  });
  it('稀疏大于4GiB目录不会32位截断，也不分配或伪称验证完整大dump', async () => {
    const small = await archive(), data = payloads(small.bytes), dumpBytes = 0x100000001;
    const entries = [{ name: 'dump.sql', offset: 0, bytes: dumpBytes, crc: 0 }, { name: 'manifest.json', offset: 58 + dumpBytes + 24, bytes: data.json.length, crc: referenceCrc(data.json) }];
    const descriptor = (entry: typeof entries[number]) => { const b = Buffer.alloc(24); b.writeUInt32LE(0x08074b50); b.writeUInt32LE(entry.crc, 4); b.writeBigUInt64LE(BigInt(entry.bytes), 8); b.writeBigUInt64LE(BigInt(entry.bytes), 16); return b; };
    const central = entries[1].offset + 63 + data.json.length + 24, directory = Buffer.concat(entries.map(queryZipDirectory));
    const segments = [{ at: 0n, bytes: small.bytes.subarray(0, 58) }, { at: 58n + BigInt(dumpBytes), bytes: descriptor(entries[0]) }, { at: BigInt(entries[1].offset), bytes: small.bytes.subarray(58 + data.dump.length + 24, 58 + data.dump.length + 24 + 63) }, { at: BigInt(entries[1].offset + 63), bytes: data.json }, { at: BigInt(central - 24), bytes: descriptor(entries[1]) }, { at: BigInt(central), bytes: directory }, { at: BigInt(central + directory.length), bytes: queryZipEnd(2, central, directory.length) }];
    const seen: bigint[] = []; let total = 0;
    const sparse: DatabaseBackupArchiveReader = { size: BigInt(central + directory.length + 98), async read(at, length) {
      expect(length).toBeLessThanOrEqual(limits.blockBytes); total += length; seen.push(at);
      const segment = segments.find(s => at >= s.at && at + BigInt(length) <= s.at + BigInt(s.bytes.length));
      if (!segment) { expect(at).toBe(58n); throw Error('合成大dump未提供原字节，不能作完整性验收'); }
      const start = Number(at - segment.at); return segment.bytes.subarray(start, start + length);
    } };
    await expect(inspectDatabaseBackupArchive(sparse)).rejects.toThrow('合成大dump');
    expect(seen.some(at => at > 0xffffffffn)).toBe(true); expect(total).toBeLessThan(70000);
  });
});
