import type { TableAutoIncrementCapability, TableAutoIncrementPolicy, TableAutoIncrementTarget } from '../shared/tableAutoIncrement';
import { identifier } from './sql';
import { structureTaskQuery, type StructureTaskContext } from './structureDefinition';

/** 保留MySQL8原守卫；旧引擎先限于已有官方源码依据的补丁版本，不猜未来能力。 */
export function tableAutoIncrementCapability(dialect: string, serverVersion: string): TableAutoIncrementCapability | undefined {
  if (dialect === 'mysql') {
    const version = /^(\d+)\.(\d+)\.(\d+)/.exec(serverVersion);
    if (version?.[1] === '8' && (version[2] === '4' || version[2] === '0' && Number(version[3]) >= 30)) return 'mysql8-stats-expiry';
    if (/^5\.7\.44(?:[-+]|$)/.test(serverVersion)) return 'mysql57-native-status';
  } else if (dialect === 'mariadb') {
    const version = serverVersion.replace(/^5\.5\.5-/, '');
    if (/^10\.11\.19(?:[-+]|$)/.test(version)) return 'mariadb1011-native-status';
    if (/^11\.4\.13(?:[-+]|$)/.test(version)) return 'mariadb114-native-status';
  }
  return undefined;
}

/** 原生计数必须由驱动提供十进制字符串；不把已舍入的Number再转换成字符串。 */
export async function readTableAutoIncrementNativeCounter(context: StructureTaskContext, target: TableAutoIncrementTarget): Promise<string> {
  const literal = `CONVERT(X'${Buffer.from(target.table).toString('hex')}' USING utf8mb4)`;
  const rows = (await structureTaskQuery<{ Name: string; Engine: string; Auto_increment: unknown }[]>(context, `SHOW TABLE STATUS FROM ${identifier(target.database)} WHERE CAST(Name AS BINARY)=CAST(${literal} AS BINARY)`)).rows;
  if (rows.length !== 1 || rows[0].Name !== target.table || rows[0].Engine !== 'InnoDB' || typeof rows[0].Auto_increment !== 'string' || !/^[1-9][0-9]{0,19}$/.test(rows[0].Auto_increment)) throw new Error('原生表状态未唯一提供同名InnoDB表的精确计数字符串，当前只读');
  return rows[0].Auto_increment;
}

/** 每个方言只查询存在的变量；读不到、缺字段、只读、恢复或Galera均保守拒绝。 */
export async function readTableAutoIncrementPolicy(context: StructureTaskContext): Promise<TableAutoIncrementPolicy> {
  const maria = context.managed.status.dialect === 'mariadb';
  const fields: [string, keyof TableAutoIncrementPolicy][] = [
    ['SESSION.auto_increment_increment', 'sessionIncrement'], ['SESSION.auto_increment_offset', 'sessionOffset'],
    ['GLOBAL.auto_increment_increment', 'globalIncrement'], ['GLOBAL.auto_increment_offset', 'globalOffset'],
    ['GLOBAL.innodb_autoinc_lock_mode', 'lockMode'], ['GLOBAL.read_only', 'readOnly'],
    ...(!maria ? [['GLOBAL.super_read_only', 'superReadOnly']] as [string, keyof TableAutoIncrementPolicy][] : []),
    ['GLOBAL.innodb_read_only', 'innodbReadOnly'], ['GLOBAL.innodb_force_recovery', 'forceRecovery'],
    ...(maria ? [['GLOBAL.innodb_read_only_compressed', 'compressedReadOnly'], ['GLOBAL.wsrep_on', 'globalWsrep'], ['SESSION.wsrep_on', 'sessionWsrep']] as [string, keyof TableAutoIncrementPolicy][] : []),
  ];
  const rows = (await structureTaskQuery<TableAutoIncrementPolicy[]>(context, 'SELECT ' + fields.map(([variable, alias]) => `CAST(@@${variable} AS CHAR) AS ${alias}`).join(', '))).rows;
  const row = rows[0], keys = fields.map(([, alias]) => alias);
  if (rows.length !== 1 || !row || Object.keys(row).length !== keys.length || keys.some(key => typeof row[key] !== 'string') || !['0', '1', '2'].includes(row.lockMode)
    || ['sessionIncrement', 'sessionOffset', 'globalIncrement', 'globalOffset'].some(key => row[key as keyof TableAutoIncrementPolicy] !== '1')
    || keys.filter(key => !['sessionIncrement', 'sessionOffset', 'globalIncrement', 'globalOffset', 'lockMode'].includes(key)).some(key => row[key] !== '0')) throw new Error('自增步长/偏移不是1、服务器/InnoDB只读、强制恢复、Galera或运行模式未知，当前仅可查看');
  return row;
}

/** 持久化能力不是下一次插入或重启后精确值承诺；5.7同时披露初始化读取的锁成本。 */
export function tableAutoIncrementCapabilityWarnings(capability?: TableAutoIncrementCapability): string[] {
  if (capability === 'mysql57-native-status') return ['MySQL 5.7的自增计数只保存在内存中；服务器重启会使本次仅由ALTER上调的设置失效，并按已有记录重新初始化，不能依赖该值跨重启保留。未初始化表的状态读取可能由服务器扫描最大值并等待锁。'];
  if (capability === 'mariadb1011-native-status' || capability === 'mariadb114-native-status') return ['MariaDB的InnoDB自增计数持久化，但不具备事务回滚语义；失败插入、回滚及重启恢复可能使观测变化。本次只核验当前目录，不承诺重启后精确值；必须暂停外部写入。'];
  return [];
}
