import { bindDatabaseEncodingTarget, databaseEncodingGate } from './databaseDefaultEncodingIntegration';

export const generatedColumnIntegrationGate = 'DBARK_GENERATED_COLUMN_TEST';

/** 复用六实例准确身份合同；仅把本用途独立双门映射给既有绑定器，不读取文件或补目标。 */
export function bindGeneratedColumnTarget(read: () => Record<string, string | undefined>, id: string) {
  return bindDatabaseEncodingTarget(() => {
    const raw = read();
    if (Object.hasOwn(raw, databaseEncodingGate)) throw Error('生成列验收不能同时开启数据库编码用途');
    return { ...raw, [databaseEncodingGate]: raw[generatedColumnIntegrationGate] };
  }, id);
}

// 原生命周期、原连接/流关闭和精确预览写入审计共用成熟端口；不替换真实数据库响应。
export {
  databaseEncodingLifetime as generatedColumnLifetime,
  loadDatabaseEncodingModules as loadGeneratedColumnModules,
  assertDatabaseEncodingIdentity as assertGeneratedColumnIdentity,
  watchDatabaseEncodingConnection as watchGeneratedColumnConnection,
  assertDatabaseEncodingReleased as assertGeneratedColumnReleased,
  closeDatabaseEncodingObserver as closeGeneratedColumnObserver,
  type DatabaseEncodingConnectionFact as GeneratedColumnConnectionFact,
  type DatabaseEncodingLifetime as GeneratedColumnLifetime,
} from './databaseDefaultEncodingIntegration';
