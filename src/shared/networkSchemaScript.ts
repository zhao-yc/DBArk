import { z } from 'zod';

const identifier = z.string().min(1).max(64).refine(value => !value.includes('\0'));
export const networkSchemaScriptSchema = z.object({
  connectionId: z.string().min(1).max(200), database: identifier, name: identifier,
  kind: z.enum(['table', 'view']), taskId: z.string().uuid(),
}).strict();
export type NetworkSchemaScriptInput = z.infer<typeof networkSchemaScriptSchema>;
export const networkSchemaDefinitionBytes = 2 * 1024 * 1024;
const scriptBytes = networkSchemaDefinitionBytes + 4096;
const outputSchema = z.object({ source: networkSchemaScriptSchema, sql: z.string().min(1).max(scriptBytes) }).strict();
export type NetworkSchemaScriptOutput = z.infer<typeof outputSchema>;

/** 原窗口只能消费自己请求的完整脚本，不接受别的对象或旧请求的回执。 */
export function assertNetworkSchemaScript(output: unknown, source: NetworkSchemaScriptInput): NetworkSchemaScriptOutput {
  const result = outputSchema.parse(output);
  if (JSON.stringify(result.source) !== JSON.stringify(networkSchemaScriptSchema.parse(source)) || new TextEncoder().encode(result.sql).length > scriptBytes || result.sql.includes('\0')) throw Error('结构 SQL 草稿的来源或大小无效');
  return result;
}
