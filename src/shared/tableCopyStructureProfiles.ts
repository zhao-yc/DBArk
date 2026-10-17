/** 版本合同只决定可尝试的读取/语义范围；Linux、物理身份、权限和目录等守卫仍须逐项通过。 */
export type TableCopyStructureServerProfile = Readonly<{
  id: 'mysql-8.4.11-like-v1' | 'mysql-8.0.46-like-preparation-v1' | 'unsupported';
  state: 'verified' | 'pending-semantics' | 'unsupported';
  canReadFacts: boolean; canWrite: boolean;
  /** null表示本版本未证明，绝不以8.4的1填充或从空表推断。 */
  expectedNewCounter: '1' | null; readonlyReason: string;
}>;

/** 服务端和后续界面共用集中中文文案，准备态不能被解释成当前已支持。 */
export const tableCopyStructureProfileText = Object.freeze({
  mysql80Pending: 'MySQL8.0.46仅作只读兼容准备，CREATE LIKE及准确新表计数语义待Root独占实测；不签发可执行预览，不外推8.4规则。',
  unsupported: '复制结构写能力当前仅开放已核MySQL8.4.11/Linux/ASCII非分区InnoDB范围；其它版本只读或不支持。',
  changed: '复制结构版本能力合同已变化，请重新读取；未发送DDL。',
});
const mysql84: TableCopyStructureServerProfile = Object.freeze({ id: 'mysql-8.4.11-like-v1', state: 'verified', canReadFacts: true, canWrite: true, expectedNewCounter: '1', readonlyReason: '' });
const mysql80: TableCopyStructureServerProfile = Object.freeze({ id: 'mysql-8.0.46-like-preparation-v1', state: 'pending-semantics', canReadFacts: true, canWrite: false, expectedNewCounter: null, readonlyReason: tableCopyStructureProfileText.mysql80Pending });
const unsupported: TableCopyStructureServerProfile = Object.freeze({ id: 'unsupported', state: 'unsupported', canReadFacts: false, canWrite: false, expectedNewCounter: null, readonlyReason: tableCopyStructureProfileText.unsupported });

/** 只识别两个准确补丁版本，保留原8.4后缀规则；没有环境开关、端口猜测或未来版本放行。 */
export function tableCopyStructureServerProfile(dialect: string, version: string): TableCopyStructureServerProfile {
  if (dialect !== 'mysql') return unsupported;
  if (/^8\.4\.11(?:[-+].*)?$/.test(version)) return mysql84;
  if (/^8\.0\.46(?:[-+].*)?$/.test(version)) return mysql80;
  return unsupported;
}
