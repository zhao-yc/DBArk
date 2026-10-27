import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedConnection } from '../../src/engine/connection';
import type { TableInfo } from '../../src/shared/contracts';
import { fileImportKeyCatalogSchema } from '../../src/shared/fileImportConflict';
const metadata = vi.hoisted(() => ({ tableInfo: vi.fn() }));
vi.mock('../../src/engine/metadata', () => metadata);
import { readFileImportKeyCatalog, type FileImportCatalogQuery } from '../../src/engine/fileImportConflictCatalog';

const target = { connectionId: 'offline', database: 'd', table: 't' };
let info: TableInfo, managed: ManagedConnection, headers: string[], stats: Record<string, unknown>[];
/** 只有服务器目录返回值为内存端口，真实定义解析与STATISTICS交叉证明保持运行。 */
beforeEach(() => {
  info = { database: 'd', name: 't', objectKind: 'table', engine: 'InnoDB', columns: [{ name: 'id', type: 'int', nullable: false, generated: false, defaultValue: null, extra: '', comment: '' }], indexes: [{ name: 'PRIMARY', unique: true, columns: ['id'] }], primaryKey: ['id'], editableKey: ['id'], foreignKeys: [], ddl: 'CREATE TABLE `t` (`id` int NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB AUTO_INCREMENT=10' };
  managed = { connection: { threadId: 99 }, status: { dialect: 'mysql', version: '8.4.11' }, sqlMode: '', broken: false, serverStatus: 3, transactionStateKnown: true } as unknown as ManagedConnection;
  headers = ['INDEX_NAME', 'COLUMN_NAME', 'SEQ_IN_INDEX', 'NON_UNIQUE', 'INDEX_TYPE', 'COLLATION', 'SUB_PART', 'INDEX_COMMENT', 'EXPRESSION', 'IS_VISIBLE'];
  stats = [{ INDEX_NAME: 'PRIMARY', COLUMN_NAME: 'id', SEQ_IN_INDEX: 1, NON_UNIQUE: 0, INDEX_TYPE: 'BTREE', COLLATION: 'A', SUB_PART: null, INDEX_COMMENT: '', EXPRESSION: null, IS_VISIBLE: 'YES' }];
  metadata.tableInfo.mockReset().mockImplementation(async () => structuredClone(info));
});
/** 返回独立目录事实，不从产品输出反向构造预期。 */
async function read() {
  const query: FileImportCatalogQuery = async <T>(sql: string) => (sql.includes('FROM information_schema.STATISTICS') ? stats : headers.map(COLUMN_NAME => ({ COLUMN_NAME }))) as T;
  const result = await readFileImportKeyCatalog(managed, target, query); fileImportKeyCatalogSchema.parse(result.catalog); return result.catalog;
}

describe('可靠导入键目录纯证明与稳定摘要', () => {
  it('自增下一值、线程变化不改变schemaHash，结构或排序规则变化必须改变', async () => {
    const first = await read(); info.ddl = info.ddl.replace('=10', '=999'); managed.connection.threadId = 100;
    expect((await read()).schemaHash).toBe(first.schemaHash);
    info.collation = 'utf8mb4_bin'; expect((await read()).schemaHash).not.toBe(first.schemaHash);
  });
  it.each(['prefix', 'invisible', 'nullable', 'generated', 'ignored'] as const)('%s唯一键不能直接沿editableKey放行', async kind => {
    if (kind === 'prefix') {
      info.columns[0].type = 'varchar(20)'; info.ddl = 'CREATE TABLE `t` (`id` varchar(20) NOT NULL, UNIQUE KEY `PRIMARY` (`id`(3))) ENGINE=InnoDB'; stats[0].SUB_PART = 3;
    }
    if (kind === 'invisible') { info.ddl = info.ddl.replace('PRIMARY KEY (`id`)', 'UNIQUE KEY `PRIMARY` (`id`) INVISIBLE'); stats[0].IS_VISIBLE = 'NO'; }
    if (kind === 'nullable') { info.columns[0].nullable = true; info.ddl = info.ddl.replace('int NOT NULL', 'int NULL'); }
    if (kind === 'generated') { info.columns[0].generated = true; info.columns[0].extra = 'STORED GENERATED'; info.ddl = 'CREATE TABLE `t` (`id` int GENERATED ALWAYS AS (1) STORED NOT NULL, PRIMARY KEY (`id`)) ENGINE=InnoDB'; }
    if (kind === 'ignored') { headers.push('IGNORED'); stats[0].IGNORED = 'YES'; }
    expect((await read()).keys[0]).toMatchObject({ reliable: false, reason: expect.any(String) });
  });
  it('函数表达式键保留不可选原因，不把空COLUMN_NAME拼成部分可靠键', async () => {
    info.ddl = 'CREATE TABLE `t` (`id` int NOT NULL, UNIQUE KEY `u` ((abs(`id`)))) ENGINE=InnoDB'; info.indexes = [{ name: 'u', unique: true, columns: [] }];
    stats[0] = { ...stats[0], INDEX_NAME: 'u', COLUMN_NAME: null, EXPRESSION: 'abs(`id`)' };
    expect((await read()).keys).toEqual([{ name: 'u', columns: [], reliable: false, reason: expect.any(String) }]);
  });
  it('5.7真实目录无不可见功能可证明可见，8.x缺EXPRESSION目录则拒选', async () => {
    managed.status.version = '5.7.44'; headers = headers.filter(name => !['EXPRESSION', 'IS_VISIBLE'].includes(name));
    expect((await read()).keys[0].reliable).toBe(true);
    managed.status.version = '8.4.11'; headers.push('IS_VISIBLE'); expect((await read()).keys[0].reliable).toBe(false);
  });
  it('MariaDB以IGNORED=NO证明，未知忽略状态不能猜可选', async () => {
    managed.status.dialect = 'mariadb'; managed.status.version = '10.11.19-MariaDB'; headers = headers.filter(name => !['EXPRESSION', 'IS_VISIBLE'].includes(name)); headers.push('IGNORED'); stats[0].IGNORED = 'NO';
    expect((await read()).keys[0].reliable).toBe(true);
    stats[0].IGNORED = 'UNKNOWN'; await expect(read()).rejects.toThrow();
  });
  it('定义/目录缺项或原事务未知必须失败，不返回部分可用目录', async () => {
    stats = []; await expect(read()).rejects.toThrow('数量');
    managed.transactionStateKnown = false; await expect(read()).rejects.toThrow('事务');
  });
  it('目录字段类型或可空属性与定义矛盾不能放行', async () => {
    info.columns[0].type = 'bigint'; await expect(read()).rejects.toThrow('字段类型');
  });
});
