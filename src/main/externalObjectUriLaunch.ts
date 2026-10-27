import { z } from 'zod';
import { externalObjectUriLimits } from '../shared/externalObjectUris';
import { parseObjectUri } from '../shared/workbench';
import type { ExternalObjectUris } from './externalObjectUris';

const launchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('url'), uri: z.string().max(externalObjectUriLimits.uriCharacters) }).strict(),
  z.object({ kind: z.literal('error'), code: z.enum(['invalid', 'multiple']) }).strict()
]);
type Launch = z.infer<typeof launchSchema>;
const envelopeSchema = z.object({ dbarkObjectUri: launchSchema }).strict();

/** 只解析本进程收到的原参数。协议启动不得夹带额外参数，避免解码引号截出合法的半截链接。 */
export function captureObjectUriLaunch(argv: readonly string[], development: boolean): { dbarkObjectUri: Launch } {
  const error = (code: 'invalid' | 'multiple' = 'invalid') => ({ dbarkObjectUri: { kind: 'error', code } as Launch });
  if (argv.length > externalObjectUriLimits.argvItems) return error();
  let size = 0;
  for (const item of argv) {
    if (typeof item !== 'string' || item.length > externalObjectUriLimits.argvCharacters - size) return error();
    size += item.length;
  }
  const args = argv.slice(development ? 2 : 1);
  const candidates = args.filter(item => /^dbark:/i.test(item));
  if (candidates.length === 0) return { dbarkObjectUri: { kind: 'none' } };
  if (candidates.length > 1) return error('multiple');
  if (args.length !== 1) return error();
  try { parseObjectUri(candidates[0]); }
  catch { return error(); }
  return { dbarkObjectUri: { kind: 'url', uri: candidates[0] } };
}

/** 副实例传原始参数的有界解析结果；不信任 Chromium 可能重排、追加的 second-instance argv。 */
export function receiveObjectUriLaunch<Owner>(queue: ExternalObjectUris<Owner>, data: unknown): void {
  const parsed = envelopeSchema.safeParse(data);
  const launch: Launch = parsed.success ? parsed.data.dbarkObjectUri : { kind: 'error', code: 'invalid' };
  if (launch.kind === 'none') return;
  if (launch.kind === 'url') { queue.receiveUrl(launch.uri); return; }
  // 只生成固定哨兵，由队列建立新错误编号；不回显不可信系统参数。
  queue.receiveArgv(launch.code === 'multiple' ? ['dbark:invalid', 'dbark:invalid'] : ['dbark:invalid']);
}
