import type { ConnectionProfile } from './contracts';

/** MySQL与MariaDB共享连接驱动，SQLite和PostgreSQL各自持有独立的连接与凭据。 */
export function sameConnectionFamily(left: ConnectionProfile['dialect'], right: ConnectionProfile['dialect']): boolean {
  return left === right || (left === 'mysql' && right === 'mariadb') || (left === 'mariadb' && right === 'mysql');
}
