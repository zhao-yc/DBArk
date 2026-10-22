import { z } from 'zod';
/** 与真实目录兼容的完整配对；不沿用旧同charset排序规则片段的64字符collation限制。 */
export const columnEncodingSchema = z.object({ charset: z.string().regex(/^[A-Za-z0-9_]{1,64}$/), collation: z.string().regex(/^[A-Za-z0-9_]{1,255}$/) }).strict();
export const columnEncodingAcknowledgement = 'column-encoding-copy';
export const columnEncodingMessages = {
  unavailable: '跨字符集转换的完整目录、物理身份或索引预算尚未证明，请重新读取。',
  isolated: '列字符集转换必须为单列单属性独立修改。',
  risks: '整表生成列、CHECK、未知属性或表达式默认值可能在COPY中重新计算，当前不能证明保真。',
  foreign: '目标列参与外键，单列转换不能同步证明两端编码；请使用后续多目标结构工作流。',
  index: '转换后的实际字符集MAXLEN使完整/前缀复合索引超过已证明字节预算。',
  lossy: '整列或文本默认值不能按目标字符集往返保持原字节，已拒绝DDL。',
  warning: '字符集预检出现服务器警告，不能证明无损；已拒绝DDL。',
} as const;
