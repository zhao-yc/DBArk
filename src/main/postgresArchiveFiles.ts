import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { exportPostgresArchiveSql, inspectPostgresArchive, listPostgresArchive, type PostgresArchiveSource } from '../engine/postgres/customArchive';
import { inspectPostgresNativeTool, type PostgresNativeTool } from '../engine/postgres/nativeTool';
import type { PostgresArchiveExportInput, PostgresArchiveListInput } from '../shared/postgresArchive';

type PickKind = 'tool' | 'source' | 'export';
type Choice<T> = { token: string; value: T };
interface Selections {
  tool?: Choice<PostgresNativeTool<'pg_restore'>>;
  source?: Choice<PostgresArchiveSource> & { expires: number };
}
interface Job {
  id: string;
  abort: AbortController;
  publishing: boolean;
}
interface Ports<Owner> {
  document(owner: Owner): object;
  assert(owner: Owner): void;
  pick(owner: Owner, kind: PickKind, suggestedName?: string): Promise<string | undefined>;
  reserve(path: string): Promise<() => void>;
  assertDestination(path: string): Promise<void>;
}

const cancelled = () => Error('PostgreSQL 归档操作已取消');

/** 只保存系统对话框授权的工具和归档，渲染进程只能用同一文档的令牌访问。 */
export class PostgresArchiveFiles<Owner> {
  private readonly selections = new WeakMap<object, Selections>();
  private readonly choosing = new WeakSet<object>();
  private readonly jobs = new Map<object, Job>();
  constructor(private readonly ports: Ports<Owner>) {}

  async choose(owner: Owner, kind: 'tool' | 'source') {
    this.ports.assert(owner);
    const key = this.ports.document(owner);
    this.assertIdle(key);
    const original = this.selections.get(key) ?? {};
    this.selections.set(key, original);
    delete original[kind];
    this.choosing.add(key);
    try {
      const path = await this.ports.pick(owner, kind);
      this.ports.assert(owner);
      if (!path) return null;
      const token = randomUUID();
      if (kind === 'tool') {
        const value = await inspectPostgresNativeTool(path, 'pg_restore');
        this.ports.assert(owner);
        original.tool = { token, value };
      } else {
        const value = await inspectPostgresArchive(path, () => this.ports.assert(owner));
        this.ports.assert(owner);
        original.source = { token, value, expires: Date.now() + 10 * 60_000 };
      }
      return { token, name: basename(path) };
    } finally { this.choosing.delete(key); }
  }

  list(owner: Owner, input: PostgresArchiveListInput) {
    return this.run(owner, input, (tool, source, signal, check) => listPostgresArchive(source, tool, signal, check));
  }

  exportSql(owner: Owner, input: PostgresArchiveExportInput) {
    return this.run(owner, input, async (tool, source, signal, check, publishing) => {
      const name = basename(source.path).replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120);
      const target = await this.ports.pick(owner, 'export', (name || 'postgresql') + '-恢复.sql');
      check();
      if (!target) return null;
      const release = await this.ports.reserve(target);
      try {
        check();
        await this.ports.assertDestination(target);
        check();
        return await exportPostgresArchiveSql(source, tool, target, input, signal, check, publishing);
      } finally { release(); }
    });
  }

  cancel(owner: Owner, operationId: string) {
    this.ports.assert(owner);
    const job = this.jobs.get(this.ports.document(owner));
    if (job?.id === operationId && !job.publishing) job.abort.abort(cancelled());
  }

  cancelAll() {
    for (const job of this.jobs.values()) if (!job.publishing) job.abort.abort(cancelled());
  }

  private assertIdle(key: object) {
    if (this.choosing.has(key) || this.jobs.has(key)) throw Error('原窗口仍有 PostgreSQL 归档操作在执行');
  }

  private async run<T>(owner: Owner, input: PostgresArchiveListInput, action: (
    tool: PostgresNativeTool<'pg_restore'>, source: PostgresArchiveSource, signal: AbortSignal,
    check: () => void, publishing: () => void,
  ) => Promise<T>): Promise<T> {
    this.ports.assert(owner);
    const key = this.ports.document(owner);
    this.assertIdle(key);
    const selected = this.selections.get(key);
    const { source, tool } = selected ?? {};
    if (source?.token !== input.sourceToken || tool?.token !== input.toolToken || source.expires <= Date.now())
      throw Error('PostgreSQL 归档或 pg_restore 选择已失效，请重新选择');
    const job = { id: input.operationId, abort: new AbortController(), publishing: false };
    this.jobs.set(key, job);
    const check = () => { job.abort.signal.throwIfAborted(); this.ports.assert(owner); };
    try {
      return await action(tool.value, source.value, job.abort.signal, check, () => {
        check(); job.publishing = true;
      });
    } finally { this.jobs.delete(key); }
  }
}
