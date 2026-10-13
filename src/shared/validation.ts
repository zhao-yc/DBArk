import { z } from 'zod';
import type { Command } from './contracts';
import { FILTER_LIMITS, validateFilterRules } from './filtering';

const id = z.string().min(1).max(200);
const name = z.string().min(1).max(256);
const text = z.string().max(20_000_000);
const empty = z.object({}).strict();
const port = z.number().int().min(1).max(65535);
const cell = z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.object({ type: z.literal('binary'), base64: z.string() }).strict()]);
const row = z.record(z.string(), cell);
const ssh = z.object({ enabled: z.boolean(), host: z.string().max(512), port, user: z.string().max(256), password: z.string().optional(), hasPassword: z.boolean().optional(), privateKeyPath: z.string().optional(), passphrase: z.string().optional(), hasPassphrase: z.boolean().optional(), hostFingerprint: z.string().optional() }).strict();
export const connectionSchema = z.object({ id: z.string().max(200), name, group: z.string().max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), dialect: z.enum(['mysql','mariadb']), host: z.string().min(1).max(512), port, user: z.string().max(256), database: z.string().max(256).optional(), password: z.string().optional(), rememberPassword: z.boolean().optional(), hasPassword: z.boolean().optional(), ssh: ssh.optional(), tls: z.object({ enabled: z.boolean(), rejectUnauthorized: z.boolean(), caPath: z.string().optional(), certPath: z.string().optional(), keyPath: z.string().optional() }).strict().optional() }).strict();
const target = { connectionId: id, database: name, table: name };
const changes = z.array(z.discriminatedUnion('kind', [z.object({ kind: z.literal('insert'), values: row }).strict(), z.object({ kind: z.literal('update'), before: row, values: row }).strict(), z.object({ kind: z.literal('delete'), before: row }).strict()])).min(1).max(5000);
const index = z.object({ name, unique: z.boolean(), columns: z.array(name).min(1) }).strict();
const foreignKey = z.object({ name, columns: z.array(name).min(1), referencedDatabase: name, referencedTable: name, referencedColumns: z.array(name).min(1), onUpdate: z.enum(['RESTRICT','CASCADE','SET NULL','NO ACTION']), onDelete: z.enum(['RESTRICT','CASCADE','SET NULL','NO ACTION']) }).strict();
const fileOptions = { ...target, fileToken: id, format: z.enum(['csv','json','sql']), encoding: z.enum(['utf8','utf16le','gb18030']), taskId: id };
const filterValue = z.string().max(FILTER_LIMITS.valueLength, `每个筛选值不能超过 ${FILTER_LIMITS.valueLength} 个字符`);
const filterRule = z.object({ column: name, operator: z.enum(['=','!=','>','>=','<','<=','LIKE','NOT LIKE','IN','NOT IN','BETWEEN','IS NULL','IS NOT NULL']), value: filterValue.optional(), values: z.array(filterValue).max(FILTER_LIMITS.setValues, `筛选集合不能超过 ${FILTER_LIMITS.setValues} 个值`).optional() }).strict();
/** IPC 同时约束单项形状及整个集合体积，错误由共享校验返回中文说明。 */
const tablePage = z.object({ ...target, page: z.number().int().min(1).max(10000000), pageSize: z.number().int().min(1).max(1000), filters: z.array(filterRule).max(FILTER_LIMITS.conditions), filterMode: z.enum(['all','any']).optional(), sort: z.array(z.object({ column: name, direction: z.enum(['ASC','DESC']) }).strict()).max(20) }).strict().superRefine((input, context) => {
  try { validateFilterRules(input.filters, input.filterMode); }
  catch (error) { context.addIssue({ code: 'custom', path: ['filters'], message: error instanceof Error ? error.message : '筛选条件无效' }); }
});
export const commandSchemas: Record<Command, z.ZodType> = {
  'app.info': empty,
  'app.setDirty': z.object({ dirty: z.boolean() }).strict(),
  'connections.list': empty, 'connections.save': connectionSchema, 'connections.test': connectionSchema,
  'connections.delete': z.object({ id }).strict(), 'connections.open': z.object({ id }).strict(), 'connections.close': z.object({ id }).strict(),
  'metadata.databases': z.object({ connectionId: id }).strict(),
  'metadata.objects': z.object({ connectionId: id, database: name }).strict(),
  'metadata.table': z.object(target).strict(),
  'metadata.ddl': z.object({ connectionId: id, database: name, name, kind: z.enum(['table','view','procedure','function','trigger','event']) }).strict(),
  'sessions.open': z.object({ connectionId: id, database: name.optional() }).strict(), 'sessions.close': z.object({ sessionId: id }).strict(),
  'query.execute': z.object({ sessionId: id, sql: text.min(1), taskId: id, maxRows: z.number().int().min(1).max(100000) }).strict(),
  'query.explain': z.object({ sessionId: id, sql: text.min(1), taskId: id, maxRows: z.number().int().min(1).max(100000) }).strict(),
  'query.cancel': z.object({ taskId: id }).strict(),
  'query.transaction': z.object({ sessionId: id, action: z.enum(['begin','commit','rollback']) }).strict(),
  'table.page': tablePage,
  'table.preview': z.object({ ...target, changes }).strict(), 'table.apply': z.object({ ...target, changes, taskId: id }).strict(),
  'schema.preview': z.object({ connectionId: id, design: z.object({ database: name, name, originalName: name.optional(), engine: name, charset: name, comment: z.string(), columns: z.array(z.object({ name, originalName: name.optional(), type: name, nullable: z.boolean(), defaultValue: z.string().nullable().optional(), autoIncrement: z.boolean(), comment: z.string() }).strict()).min(1).max(1000), indexes: z.array(index), foreignKeys: z.array(foreignKey) }).strict() }).strict(),
  'schema.apply': z.object({ connectionId: id, database: z.string().max(256), sql: text.min(1), taskId: id }).strict(),
  'files.choose': z.object({ purpose: z.enum(['import','export','key','certificate','query']), format: z.string().optional(), suggestedName: z.string().optional() }).strict(),
  'files.path': z.object({ token: id }).strict(),
  'files.preview': z.object({ fileToken: id, format: z.enum(['csv','json']), encoding: z.enum(['utf8','utf16le','gb18030']) }).strict(),
  'files.import': z.object({ ...fileOptions, mapping: z.record(z.string(), z.string()) }).strict(),
  'files.export': z.object({ ...fileOptions, includeStructure: z.boolean(), includeData: z.boolean() }).strict(),
  'queries.list': empty, 'queries.save': z.object({ id, name, connectionId: id.optional(), database: name.optional(), sql: text, updatedAt: z.string() }).strict(), 'queries.delete': z.object({ id }).strict(),
  'history.list': z.object({ connectionId: id.optional() }).strict(), 'tasks.list': empty,
  'settings.get': empty, 'settings.save': z.object({ theme: z.enum(['dark','light']), sidebarWidth: z.number().min(180).max(600), resultLimit: z.number().int().min(1).max(100000), pageSize: z.number().int().min(1).max(1000), tabs: z.array(z.object({ id, kind: z.enum(['query','table']), title: name, connectionId: id, database: z.string().optional(), table: z.string().optional(), sql: text.optional() }).strict()).max(100), activeTabId: z.string().optional() }).strict()
};

/** 只接受已声明命令；剔除任意路径、原型字段和其他非约定输入。 */
export function validateCommand(command: string, input: unknown): unknown {
  if (!Object.hasOwn(commandSchemas, command)) throw new Error('不支持的客户端操作');
  const result = commandSchemas[command as Command].safeParse(input);
  if (!result.success) throw new Error(`参数无效：${result.error.issues.map(x => `${x.path.join('.')} ${x.message}`).join('；')}`);
  return result.data;
}
