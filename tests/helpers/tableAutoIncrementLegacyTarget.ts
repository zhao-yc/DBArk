import { assertTableAutoIncrementLiveTarget } from './tableAutoIncrementTarget';
import type { DefaultEncodingLiveTarget, DefaultEncodingLiveProfile } from './tableDefaultEncodingTarget';
import type { TableAutoIncrementCapability } from '../../src/shared/tableAutoIncrement';

// 端口期望来自ROOT已核对的六实例清单；实际连接后仍必须校验版本，端口本身不是能力证据。
export const tableAutoIncrementLegacyInstances: Readonly<Record<string, { dialect: 'mysql' | 'mariadb'; version: RegExp; capability: TableAutoIncrementCapability }>> = {
  '13357': { dialect: 'mysql', version: /^5\.7\.44(?:[-+]|$)/, capability: 'mysql57-native-status' },
  '13310': { dialect: 'mariadb', version: /^10\.11\.19(?:[-+]|$)/, capability: 'mariadb1011-native-status' },
  '13311': { dialect: 'mariadb', version: /^11\.4\.13(?:[-+]|$)/, capability: 'mariadb114-native-status' },
  '13380': { dialect: 'mysql', version: /^8\.0\.(?:3[0-9]|[4-9][0-9]|[1-9][0-9]{2,})(?:[-+]|$)/, capability: 'mysql8-stats-expiry' },
  '13384': { dialect: 'mysql', version: /^8\.4\.[0-9]+(?:[-+]|$)/, capability: 'mysql8-stats-expiry' },
  '13484': { dialect: 'mysql', version: /^8\.4\.[0-9]+(?:[-+]|$)/, capability: 'mysql8-stats-expiry' },
};
/** 写入范围由显式目标门和实际方言/版本共同决定；复用13484原严格TLS/同一CA守卫。 */
export function assertTableAutoIncrementLegacyTarget(target: DefaultEncodingLiveTarget, status: { dialect: string; version: string }, profile?: DefaultEncodingLiveProfile) {
  assertTableAutoIncrementLiveTarget(target, profile);
  const expected = tableAutoIncrementLegacyInstances[String(target.port)];
  if (!expected || status.dialect !== expected.dialect || !expected.version.test(status.version.replace(/^5\.5\.5-/, ''))) throw new Error('0.19端口与实际方言/补丁版本不符合已明确范围，拒绝验收写入');
  return expected.capability;
}
