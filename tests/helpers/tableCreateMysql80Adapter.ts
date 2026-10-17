import mysql, { type RowDataPacket } from 'mysql2/promise';
import type { Connection } from 'mysql2';
import { closeMysqlConnection } from '../../src/engine/connection';
import type { TableCreateMysql80PreparationPorts } from './tableCreateMysql80Preparation';

export const tableCreateMysql80FactSql = 'SELECT @@version AS version,@@version_compile_os AS os,@@lower_case_table_names AS names,@@server_uuid AS uuid';

/** 方言沿产品连接逻辑，从实际服务器版本识别，不从端口或用户配置补造。 */
export function tableCreateMysql80ObservedFacts(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map(row => row && typeof row === 'object' ? { ...row, dialect: /mariadb/i.test(String(row.version)) ? 'mariadb' : 'mysql' } : row);
}

/** 真实适配器仅提供无默认库的明文只读预检；不提供建库、DDL或取消ACK端口。 */
export function tableCreateMysql80PreparationPorts(owner: Pick<TableCreateMysql80PreparationPorts, 'assertCurrent' | 'retain'>): TableCreateMysql80PreparationPorts {
  return {
    assertCurrent: () => owner.assertCurrent(), retain: () => owner.retain(),
    async openReadonly(target, credentials) {
      const observer = await mysql.createConnection({ host: target.host, port: target.port, user: credentials.user, password: credentials.password, charset: 'utf8mb4', connectTimeout: 15000 });
      return {
        async readFacts() { const [rows] = await observer.query<RowDataPacket[]>(tableCreateMysql80FactSql); return tableCreateMysql80ObservedFacts(rows); },
        async closeStrict() {
          const connection = (observer as unknown as { connection?: Connection }).connection;
          const stream = (connection as unknown as { stream?: { once?: unknown; end?: unknown; destroy?: unknown } } | undefined)?.stream;
          if (!connection || !stream || typeof stream.once !== 'function' || typeof stream.end !== 'function' || typeof stream.destroy !== 'function') throw Error('新建表8.0.46预检底层流未知，不能确认严格关闭');
          // 等产品QUIT写入和真实本地流关闭；不能用Promise版end回包或取消响应替代资源事实。
          await closeMysqlConnection(connection, true);
        },
      };
    },
  };
}
