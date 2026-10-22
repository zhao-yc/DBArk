import { bindDatabaseEncodingTarget, databaseEncodingGate } from './databaseDefaultEncodingIntegration';

export const columnAutoIncrementIntegrationGate = 'DBARK_COLUMN_AUTO_INCREMENT_TEST';

/** 专属双门只映射既有六实例身份合同；不加载凭据、不补目标或同时授权其它专项。 */
export function bindColumnAutoIncrementTarget(read: () => Record<string, string | undefined>, id: string) {
  return bindDatabaseEncodingTarget(() => {
    const raw = read();
    if (Object.hasOwn(raw, databaseEncodingGate)) throw Error('列自增验收不能同时开启数据库编码用途');
    return { ...raw, [databaseEncodingGate]: raw[columnAutoIncrementIntegrationGate] };
  }, id);
}

// 原连接与协议仍真实执行；共用准确SQL、原生流关闭及原120秒生命周期证据。
export {
  databaseEncodingLifetime as columnAutoIncrementLifetime,
  loadDatabaseEncodingModules as loadColumnAutoIncrementModules,
  assertDatabaseEncodingIdentity as assertColumnAutoIncrementIdentity,
  watchDatabaseEncodingConnection as watchColumnAutoIncrementConnection,
  assertDatabaseEncodingReleased as assertColumnAutoIncrementReleased,
  closeDatabaseEncodingObserver as closeColumnAutoIncrementObserver,
  type DatabaseEncodingConnectionFact as ColumnAutoIncrementConnectionFact,
  type DatabaseEncodingLifetime as ColumnAutoIncrementLifetime,
} from './databaseDefaultEncodingIntegration';
