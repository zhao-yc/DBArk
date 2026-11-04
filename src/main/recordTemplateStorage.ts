import { randomUUID } from 'node:crypto';
import type { Database } from 'sql.js';
import { recordTemplateDocumentSchema, recordTemplateLimits as limits, recordTemplateTargetSchema, recordTemplateSaveSchema, recordTemplateSelectSchema, recordTemplateRenameSchema, recordTemplateSummary,
  type RecordTemplateContent, type RecordTemplateDocument, type RecordTemplateTarget, type RecordTemplateSource, type RecordTemplateStored, type RecordTemplateSave, type RecordTemplateSelect } from '../shared/recordTemplates';

interface Ports { source(target: RecordTemplateTarget): RecordTemplateSource; mutate(action: () => void, assertCurrent?: () => void): void; }

/** 原始JSON先计全库预算再解析；迁移前也调用它，损坏或未知版本不能被自动重写掩盖。 */
export function readRecordTemplateDocuments(db: Database): RecordTemplateDocument[] {
  if (!db.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='record_templates'").length) return [];
  const count = Number(db.exec('SELECT COUNT(*) FROM record_templates')[0]?.values[0]?.[0] ?? 0);
  if (count > limits.targets) throw Error('记录模板超过200个目标上限');
  const statement = db.prepare('SELECT connection_id,database_name,table_name,data FROM record_templates');
  const documents: RecordTemplateDocument[] = []; let bytes = 0, entries = 0;
  try {
    while (statement.step()) {
      const row = statement.getAsObject(), raw = row.data;
      if (typeof raw !== 'string' || raw.length > limits.totalBytes) throw Error('记录模板存储内容无效或超限');
      bytes += Buffer.byteLength(raw, 'utf8'); if (bytes > limits.totalBytes) throw Error('记录模板超过8 MiB本机内容上限');
      const document = recordTemplateDocumentSchema.parse(JSON.parse(raw));
      if (document.target.connectionId !== row.connection_id || document.target.database !== row.database_name || document.target.table !== row.table_name) throw Error('记录模板存储目标不匹配');
      entries += document.entries.length; if (entries > limits.entries) throw Error('记录模板超过200项上限');
      documents.push(document);
    }
  } finally { statement.free(); }
  return documents;
}

/** 记录值仅写本机配置库；同步CAS与原mutate事务共同保护原子落盘和失败回滚。 */
export class RecordTemplateStorage {
  constructor(private readonly db: Database, private readonly ports: Ports) {}
  /** 数组式目标比较保留所有分隔符、大小写和原型同名标识。 */
  private key(target: RecordTemplateTarget): string { return JSON.stringify([target.connectionId, target.database, target.table]); }
  /** 从当前连接概要与完整已校验配置中取得准确目标，不读取目标数据库。 */
  private current(raw: unknown): { document: RecordTemplateDocument; source: RecordTemplateSource } {
    const target = recordTemplateTargetSchema.parse(raw), source = this.ports.source(target);
    const document = readRecordTemplateDocuments(this.db).find(value => this.key(value.target) === this.key(target)) ?? { version: 1 as const, target, revision: 0, entries: [] };
    return { document, source };
  }
  /** 列表不交付记录原值，连接概要变化后的旧模板仍只显示名称并明确禁止使用。 */
  list(raw: unknown): RecordTemplateStored { const { document, source } = this.current(raw); return recordTemplateSummary(document, source); }
  /** 所见修订及连接来源必须同时匹配，旧回包不能覆盖后继保存。 */
  private checked(input: RecordTemplateSave | RecordTemplateSelect): { document: RecordTemplateDocument; source: RecordTemplateSource } {
    const value = this.current({ connectionId: input.connectionId, database: input.database, table: input.table });
    if (value.document.revision !== input.expectedRevision || JSON.stringify(value.source) !== JSON.stringify(input.source)) throw Error('记录模板或连接配置已变化，请刷新后重试');
    return value;
  }
  /** 全库目标、条目和字节预算在任何SQL替换之前核对，空集合保留单调修订。 */
  private write(raw: RecordTemplateDocument): void {
    const document = recordTemplateDocumentSchema.parse(raw), key = this.key(document.target), current = readRecordTemplateDocuments(this.db).filter(value => this.key(value.target) !== key), next = [...current, document];
    if (next.length > limits.targets || next.reduce((sum, value) => sum + value.entries.length, 0) > limits.entries
      || next.reduce((sum, value) => sum + Buffer.byteLength(JSON.stringify(value), 'utf8'), 0) > limits.totalBytes) throw Error('记录模板超过200个目标、200项或8 MiB上限');
    const target = document.target;
    this.db.run('INSERT INTO record_templates VALUES (?,?,?,?) ON CONFLICT(connection_id,database_name,table_name) DO UPDATE SET data=excluded.data', [target.connectionId, target.database, target.table, JSON.stringify(document)]);
  }
  /** 新增与明确覆盖分开；保存的驱动必须属于原连接，不能跨驱动重解释字段值。 */
  save(raw: unknown, assertCurrent?: () => void): RecordTemplateStored {
    const input = recordTemplateSaveSchema.parse(raw); let result!: RecordTemplateStored;
    this.ports.mutate(() => {
      const { document, source } = this.checked(input), replaced = document.entries.find(value => value.id === input.replaceId);
      if (input.content.dialect !== source.dialect) throw Error('记录模板驱动与原连接不匹配');
      if (input.replaceId ? !replaced || replaced.name !== input.name : document.entries.some(value => value.name === input.name)) throw Error('同名模板已存在或已变化，请明确选择覆盖');
      const entry = { id: input.replaceId ?? randomUUID(), name: input.name, connectionDigest: source.connectionDigest, content: input.content };
      const next: RecordTemplateDocument = { ...document, revision: document.revision + 1, entries: input.replaceId ? document.entries.map(value => value.id === input.replaceId ? entry : value) : [...document.entries, entry] };
      this.write(next); result = recordTemplateSummary(next, source);
    }, assertCurrent); return result;
  }
  /** 重命名只改显示名，不续借旧连接的值；同名、旧修订或不存在的条目整份拒绝。 */
  rename(raw: unknown, assertCurrent?: () => void): RecordTemplateStored {
    const input = recordTemplateRenameSchema.parse(raw); let result!: RecordTemplateStored;
    this.ports.mutate(() => {
      const { document, source } = this.checked(input);
      if (!document.entries.some(value => value.id === input.id) || document.entries.some(value => value.id !== input.id && value.name === input.name)) throw Error('模板已删除或名称重复，请刷新');
      const next = { ...document, revision: document.revision + 1, entries: document.entries.map(value => value.id === input.id ? { ...value, name: input.name } : value) };
      this.write(next); result = recordTemplateSummary(next, source);
    }, assertCurrent); return result;
  }
  /** 删除仅消费当前本机条目，失败由原存储事务回滚，绝不删除数据库记录。 */
  remove(raw: unknown, assertCurrent?: () => void): RecordTemplateStored {
    const input = recordTemplateSelectSchema.parse(raw); let result!: RecordTemplateStored;
    this.ports.mutate(() => {
      const { document, source } = this.checked(input);
      if (!document.entries.some(value => value.id === input.id)) throw Error('模板已删除，请刷新');
      const next = { ...document, revision: document.revision + 1, entries: document.entries.filter(value => value.id !== input.id) };
      this.write(next); result = recordTemplateSummary(next, source);
    }, assertCurrent); return result;
  }
  /** 显式读取才返回值；旧连接摘要、驱动和集合修订都不能借同ID复活。 */
  read(raw: unknown): RecordTemplateContent {
    const input = recordTemplateSelectSchema.parse(raw), { document, source } = this.checked(input), entry = document.entries.find(value => value.id === input.id);
    if (!entry || entry.connectionDigest !== source.connectionDigest || entry.content.dialect !== source.dialect) throw Error('模板来源连接已变化或条目已删除，请核对并明确覆盖');
    return structuredClone(entry.content);
  }
}
