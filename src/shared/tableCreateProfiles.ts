/** 准确版本追加的准备合同；不替代既有普通MySQL/Maria创建路径的运行能力。 */
export interface TableCreatePreparationProfile {
  readonly id: 'mysql-8.0.46-create-preparation-v1' | 'unsupported';
  readonly version: '8.0.46' | null;
  readonly state: 'prepared' | 'unsupported';
  readonly canReadFacts: boolean;
  readonly canWrite: false;
  readonly reason: string;
}

const mysql80: TableCreatePreparationProfile = Object.freeze({
  id: 'mysql-8.0.46-create-preparation-v1', version: '8.0.46', state: 'prepared',
  canReadFacts: true, canWrite: false,
  reason: 'MySQL8.0.46新建表仅完成兼容准备；等待Root先验8.4并另行授权，未激活准确版本追加写入或正式UI。',
});
const unsupported: TableCreatePreparationProfile = Object.freeze({
  id: 'unsupported', version: null, state: 'unsupported', canReadFacts: false, canWrite: false,
  reason: '不属于本片准确MySQL8.0.46准备范围，不能据此启动正式执行。',
});

/** 只接受准确补丁及发行后缀；端口、环境开关、泛8.0或其它方言不能提升状态。 */
export function tableCreatePreparationProfile(dialect: string, version: string): TableCreatePreparationProfile {
  return dialect === 'mysql' && /^8\.0\.46(?:[-+][^\s]+)?$/.test(version) && !/\s/.test(version) ? mysql80 : unsupported;
}
