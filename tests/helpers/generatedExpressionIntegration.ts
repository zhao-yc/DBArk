import { bindGeneratedColumnTarget, generatedColumnIntegrationGate } from './generatedColumnIntegration';

export const generatedExpressionIntegrationGate = 'DBARK_GENERATED_EXPRESSION_TEST';

/** 表达式修改使用独立双门；共用六实例准确身份和原期限，不读取文件或同时借用新增用途。 */
export function bindGeneratedExpressionTarget(read: () => Record<string, string | undefined>, id: string) {
  return bindGeneratedColumnTarget(() => {
    const raw = read();
    if (Object.hasOwn(raw, generatedColumnIntegrationGate)) throw Error('表达式修改验收不能同时开启新增生成列用途');
    return { ...raw, [generatedColumnIntegrationGate]: raw[generatedExpressionIntegrationGate] };
  }, id);
}

// 共用原连接和原生流旁观端口，实际SQL及响应仍来自本轮真实数据库。
export {
  generatedColumnLifetime, loadGeneratedColumnModules, assertGeneratedColumnIdentity,
  watchGeneratedColumnConnection, assertGeneratedColumnReleased, closeGeneratedColumnObserver,
  type GeneratedColumnConnectionFact, type GeneratedColumnLifetime,
} from './generatedColumnIntegration';
