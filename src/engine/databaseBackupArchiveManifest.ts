/** 结构对齐固定B01合同fb4db474；本模块不拥有共享合同文件，也不提供进程/恢复能力。 */
export interface DatabaseBackupArchiveDump {
  entry: 'dump.sql';
  bytes: string;
  sha256: string;
}
export interface DatabaseBackupArchiveManifest {

  format: 'dbark-backup-zip-store-v1';
  schemaVersion: 1;
  family: 'mysql' | 'mariadb';
  serverVersion: string;
  toolVersion: string;
  toolSuiteSha256: string;
  toolRegistryRevision: string;
  database: string;

  objects: readonly { kind: 'database' | 'table' | 'view' | 'trigger' | 'procedure' | 'function' | 'event'; name: string; definitionSha256: string | null; engine?: string }[];

  dump: DatabaseBackupArchiveDump;
  consistency: { profileId: string; acquiredAt: string; completedAt: string; allObjectsFrozen: boolean };
  externalDependencies: readonly string[];
  resourcesConfirmed: boolean;
  restoreVerified: false;
}
export type DatabaseBackupArchiveManifestInput = Omit<DatabaseBackupArchiveManifest, 'dump'> & { dump?: DatabaseBackupArchiveDump };
export const databaseBackupArchiveLimits = { archiveBytes: 10n * 1024n ** 3n, manifestBytes: 2 * 1024 * 1024, blockBytes: 64 * 1024 } as const;
const invalid = () => new Error('备份清单结构、字段或预算无效');

/** 先用自有数据描述符克隆有界JSON，拒绝getter/toJSON/循环/稀疏数组，避免验证时执行调用方代码。 */
function safeClone(value: unknown): unknown {

  const stack = new Set<object>();
  let nodes = 0, bytes = 0;

  const visit = (v: unknown, depth: number): unknown => {

    if (++nodes > 100000 || depth > 20) throw invalid();

    if (typeof v === 'string') {
      bytes += Buffer.byteLength(v);
      if (bytes > databaseBackupArchiveLimits.manifestBytes) throw invalid();
      return v;
    }

    if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return v;

    if (!v || typeof v !== 'object' || stack.has(v) || !Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw invalid();

    stack.add(v);
    const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string' || !('value' in descriptors[key]))) throw invalid();

    let result: unknown;

    if (Array.isArray(v)) {
      if (v.length > 50000 || keys.length !== v.length + 1) throw invalid();
      const out: unknown[] = [];
      for (let i = 0; i < v.length; i++) {
        const d = descriptors[String(i)];
        if (!d) throw invalid();
        out.push(visit(d.value, depth + 1));
      }
      result = out;
    }
    else {
      const out = Object.create(null) as Record<string, unknown>;
      for (const key of keys as string[]) {
        bytes += Buffer.byteLength(key);
        if (bytes > databaseBackupArchiveLimits.manifestBytes) throw invalid();
        out[key] = visit(descriptors[key].value, depth + 1);
      }
      result = out;
    }

    stack.delete(v);
    return result;

  };
  return visit(value, 0);
}
function record(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid();
  const r = v as Record<string, unknown>;
  if (required.some(k => !Object.hasOwn(r, k)) || Object.keys(r).some(k => !required.includes(k) && !optional.includes(k))) throw invalid();
  return r;
}
function text(v: unknown, max = 2048): asserts v is string {
  if (typeof v !== 'string' || !v || v.includes('\0') || [...v].length > max) throw invalid();
}
function hash(v: unknown): void {
  if (typeof v !== 'string' || !/^([a-f0-9]{64})$/.test(v)) throw invalid();
}

/** 清单只表达声明；结构有效不等于对象/锁/资源/恢复事实已独立证明。 */
export function databaseBackupArchiveManifest(value: unknown, dump?: DatabaseBackupArchiveDump): { manifest: DatabaseBackupArchiveManifest; bytes: Buffer } {

  const clone = record(safeClone(value), ['format', 'schemaVersion', 'family', 'serverVersion', 'toolVersion', 'toolSuiteSha256', 'toolRegistryRevision', 'database', 'objects', 'consistency', 'externalDependencies', 'resourcesConfirmed', 'restoreVerified'], ['dump']);

  if (dump) {
    if (Object.hasOwn(clone, 'dump')) {
      const given = record(clone.dump, ['entry', 'bytes', 'sha256']);
      if (given.entry !== dump.entry || given.bytes !== dump.bytes || given.sha256 !== dump.sha256) throw Error('备份清单dump声明与实际字节不一致');
    }
    clone.dump = { ...dump };
  }

  const r = record(clone, ['format', 'schemaVersion', 'family', 'serverVersion', 'toolVersion', 'toolSuiteSha256', 'toolRegistryRevision', 'database', 'objects', 'dump', 'consistency', 'externalDependencies', 'resourcesConfirmed', 'restoreVerified']);

  if (r.format !== 'dbark-backup-zip-store-v1' || r.schemaVersion !== 1 || (r.family !== 'mysql' && r.family !== 'mariadb') || typeof r.resourcesConfirmed !== 'boolean' || r.restoreVerified !== false) throw invalid();

  text(r.serverVersion);
  text(r.toolVersion);
  hash(r.toolSuiteSha256);
  text(r.toolRegistryRevision);
  text(r.database, 64);

  if (!Array.isArray(r.objects) || !Array.isArray(r.externalDependencies)) throw invalid();
  const seen = new Set<string>();

  for (const obj of r.objects) {
    const o = record(obj, ['kind', 'name', 'definitionSha256'], ['engine']);
    if (typeof o.kind !== 'string' || !['database', 'table', 'view', 'trigger', 'procedure', 'function', 'event'].includes(o.kind)) throw invalid();
    text(o.name, 64);
    if (o.definitionSha256 !== null) hash(o.definitionSha256);
    if (Object.hasOwn(o, 'engine')) text(o.engine, 64);
    const key = JSON.stringify([o.kind, o.name]);
    if (seen.has(key)) throw invalid();
    seen.add(key);
  }

  for (const dependency of r.externalDependencies) text(dependency);

  const d = record(r.dump, ['entry', 'bytes', 'sha256']);
  if (d.entry !== 'dump.sql' || typeof d.bytes !== 'string' || d.bytes.length > 20 || !/^(0|[1-9]\d*)$/.test(d.bytes) || BigInt(d.bytes) > databaseBackupArchiveLimits.archiveBytes) throw invalid();
  hash(d.sha256);

  const c = record(r.consistency, ['profileId', 'acquiredAt', 'completedAt', 'allObjectsFrozen']);
  text(c.profileId);
  text(c.acquiredAt, 128);
  text(c.completedAt, 128);
  if (typeof c.allObjectsFrozen !== 'boolean') throw invalid();

  const encoded = JSON.stringify(r);
  if (Buffer.byteLength(encoded) > databaseBackupArchiveLimits.manifestBytes) throw invalid();
  return { manifest: r as unknown as DatabaseBackupArchiveManifest, bytes: Buffer.from(encoded, 'utf8') };
}
