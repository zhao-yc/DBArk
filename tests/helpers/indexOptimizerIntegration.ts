import { bindDatabaseEncodingTarget, databaseEncodingGate } from './databaseDefaultEncodingIntegration';

export const indexOptimizerIntegrationGate = 'DBARK_INDEX_OPTIMIZER_TEST';
/** 专属双门映射既有六实例的真实身份合同；不读取凭据文件，不替用户补配置。 */
export function bindIndexOptimizerTarget(read: () => Record<string, string | undefined>, id: string) {
  return bindDatabaseEncodingTarget(() => {
    const raw = read();
    if (Object.hasOwn(raw, databaseEncodingGate)) throw Error('索引优化器验收不能同时开启数据库编码用途');
    return { ...raw, [databaseEncodingGate]: raw[indexOptimizerIntegrationGate] };
  }, id);
}
// 原120秒owner、managed连接及原生流close全部沿用已验证的严格事实端口。
export {
  databaseEncodingLifetime as indexOptimizerLifetime,
  loadDatabaseEncodingModules as loadIndexOptimizerModules,
  assertDatabaseEncodingIdentity as assertIndexOptimizerIdentity,
  watchDatabaseEncodingConnection as watchIndexOptimizerConnection,
  assertDatabaseEncodingReleased as assertIndexOptimizerReleased,
  closeDatabaseEncodingObserver as closeIndexOptimizerObserver,
  type DatabaseEncodingConnectionFact as IndexOptimizerConnectionFact,
  type DatabaseEncodingLifetime as IndexOptimizerLifetime,
} from './databaseDefaultEncodingIntegration';
