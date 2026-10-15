/** 手动验收唯一允许的六个专用端口，不包含业务端口。 */
export const q05IsolatedPorts: readonly string[];
/** 校验原始字符串白名单及env一致性，不自动切换目标。 */
export function requireQ05IsolatedPort(selectedPort: unknown, environmentPort: unknown): number;
