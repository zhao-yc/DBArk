import { validateQueryParameters, type QueryParameter } from '../../shared/queryParameters';

/** 连续位置与类型预算在投递前验证，精确数字以文本绑定，二进制单独转为字节。 */
export function postgresParameterValues(positions: readonly number[], parameters?: QueryParameter[]): unknown[] | undefined {
  if (!parameters) {
    if (positions.length) throw Error('请为 PostgreSQL 查询设置位置参数');
    return undefined;
  }
  validateQueryParameters(parameters, 38);
  if (positions.length !== parameters.length || positions.some((position, index) => position !== index + 1))
    throw Error('PostgreSQL 参数必须连续使用 $1 至 $N，名称为 p1 至 pN');
  return parameters.map((parameter, index) => {
    if (parameter.name !== 'p' + (index + 1)) throw Error('PostgreSQL 参数顺序或名称已变化');
    if (parameter.type === 'null') return null;
    if (parameter.type === 'binary') return Buffer.from(parameter.value!, 'hex');
    return parameter.value!;
  });
}
