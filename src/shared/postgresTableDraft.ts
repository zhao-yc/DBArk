import { z } from 'zod';
import {
  postgresTableBrowseSchema, postgresTableChangeSchema, postgresTableLimits, postgresTablePreviewSchema, postgresTableReleaseSchema,
  type PostgresTableChange, type PostgresTablePage,
} from './postgresTable';

export const postgresDraftBytes = 8 * 1024 * 1024;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const oid = z.string().regex(/^[0-9]{1,10}$/u);
const target = postgresTableReleaseSchema.pick({ connectionId: true, database: true, table: true });
const window = postgresTableBrowseSchema.pick({ offset: true, limit: true });
const original = z.object({ tid: z.string().regex(/^\([0-9]{1,10},[0-9]{1,5}\)$/u), version: oid, tableOid: oid, digest }).strict();
const entry = z.object({
  group: z.number().int().min(0).max(postgresTableLimits.draftPages - 1), change: postgresTableChangeSchema, original: original.optional(),
}).strict();

/** 文件保存原页分组及操作顺序。版本、字节预算及值校验与普通提交保持一致。 */
export const postgresDraftSchema = z.object({
  version: z.literal(1), kind: z.literal('tabrelio.postgresql.tableDraft'),
  target, endpoint: digest, relation: digest, view: postgresTableBrowseSchema,
  groups: z.array(window).min(1).max(postgresTableLimits.draftPages),
  entries: z.array(entry).min(1).max(postgresTableLimits.changes),
}).strict().superRefine((file, context) => {
  const groups = new Set(file.entries.map(item => item.group));
  const token = 'b23948a3-e1a3-45a7-b139-ffb37daa23bb';
  const rows = new Set<string>();
  if (groups.size !== file.groups.length || file.entries.some(({ group, change, original }) => {
    const source = file.groups[group];
    if (!source || change.pageToken !== undefined) return true;
    if (change.kind === 'insert') return original !== undefined;
    if (!original || change.row >= source.limit) return true;
    const identity = original.tableOid + '/' + original.tid;
    if (rows.has(identity)) return true;
    rows.add(identity);
    return false;
  }) || !postgresTablePreviewSchema.safeParse({ ...file.target, tabId: token, pageToken: token,
    changes: file.entries.map(({ group, change }) => ({
      ...change, pageToken: token.slice(0, -2) + group.toString(16).padStart(2, '0'),
    })),
  }).success) context.addIssue({ code: 'custom', message: 'PostgreSQL 草稿原页、原记录或变更预算无效' });
});

export type PostgresDraftDocument = z.infer<typeof postgresDraftSchema>;
export type PostgresDraftEntry = { change: PostgresTableChange & { pageToken: string }; rowKey?: string; offset: number };
export type PostgresDraftRestored = {
  name: string; page: PostgresTablePage; view: PostgresDraftDocument['view']; entries: PostgresDraftEntry[];
};

export function encodePostgresDraft(file: PostgresDraftDocument): string {
  const source = JSON.stringify(postgresDraftSchema.parse(file));
  if (new TextEncoder().encode(source).byteLength > postgresDraftBytes) throw Error('PostgreSQL 草稿文件超过 8 MiB');
  return source;
}
export function decodePostgresDraft(source: string): PostgresDraftDocument {
  if (new TextEncoder().encode(source).byteLength > postgresDraftBytes) throw Error('PostgreSQL 草稿文件超过 8 MiB');
  return postgresDraftSchema.parse(JSON.parse(source));
}
