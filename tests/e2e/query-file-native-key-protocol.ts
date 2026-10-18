import { createHash } from 'node:crypto';

/** Root只批准这四个阶段；回执仅证明一次发送，绝不证明保存或退出成功。 */
export const queryFileNativeKeyProtocol = Object.freeze({ version: 'dbark-query-file-native-key/v2', directory: 'query-file-native-keys', stages: Object.freeze(['saved', 'external', 'draft', 'restarted'] as const), key: 'Control_L+s', receipt: Object.freeze(['sent', 'unknown'] as const), requestLimit: 16384, document: '每请求独立token与观察器；实际活动tab和sourceId固定；发布后revision可增长' } as const);
export type QueryFileNativeKeyStage = typeof queryFileNativeKeyProtocol.stages[number];
/** 摘要只来自固定协议，不以当前请求或回执内容重新审批。 */
export function queryFileNativeKeyProtocolHash(): string { return createHash('sha256').update(JSON.stringify(queryFileNativeKeyProtocol)).digest('hex'); }
/** 新开关及协议摘要共同审批；不接受外部路径、自动按键或旧CDP回退。 */
export function assertQueryFileNativeKeyApproval(env: NodeJS.ProcessEnv, platform: string): void {
  if (Object.keys(env).some(key => key.toUpperCase().startsWith('DBARK_QUERY_FILE_NATIVE_KEYS') && !['DBARK_QUERY_FILE_NATIVE_KEYS', 'DBARK_QUERY_FILE_NATIVE_KEYS_SHA256'].includes(key))) throw Error('原生按键拒绝未批准的桥变量或外部路径');
  if (platform !== 'win32' || env.DBARK_QUERY_FILE_NATIVE_KEYS !== 'root-v2' || env.DBARK_QUERY_FILE_NATIVE_KEYS_SHA256 !== queryFileNativeKeyProtocolHash()) throw Error('原生CtrlS须Root批准Windows外部按键V2协议及固定SHA256');
}
