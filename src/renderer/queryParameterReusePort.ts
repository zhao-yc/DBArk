import type { QueryParameter, QueryParameterNames } from '../shared/queryParameters';

/** 本轮参数表单只借用父标签RAM能力，不拥有连接、执行或持久化权限。 */
export interface QueryParameterReusePort {
  current(): boolean;
  has(info: QueryParameterNames): boolean;
  read(info: QueryParameterNames): QueryParameter[] | null;
  setOptIn(enabled: boolean): boolean;
  forget(): void;
  stage(info: QueryParameterNames, parameters: readonly QueryParameter[]): boolean;
  subscribe(changed: () => void): () => void;
}
