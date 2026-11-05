import type { languages } from 'monaco-editor';
import type { PostgresCompletionItem, PostgresRoutineParameter } from '../shared/postgresCompletion';
import { postgresIdentifier } from '../shared/postgresSql';
import type { analyzePostgresSignature } from './postgresCompletionAnalysis';

const modes: Partial<Record<PostgresRoutineParameter['mode'], string>> = { o: 'OUT ', b: 'INOUT ', v: 'VARIADIC ' };

function parameterLabel(parameter: PostgresRoutineParameter) {
  return (modes[parameter.mode] ?? '') + (parameter.name ? postgresIdentifier(parameter.name) + ' ' : '') +
    parameter.type + (parameter.optional ? ' DEFAULT …' : '');
}

/** 按位置或参数名收窄重载，保留服务器的类型名称，不在编辑器中猜测类型转换。 */
export function postgresSignatureHelp(items: PostgresCompletionItem[], call: NonNullable<ReturnType<typeof analyzePostgresSignature>>): languages.SignatureHelp | null {
  const signatures: languages.SignatureInformation[] = [];
  for (const item of items) {
    if (item.kind !== 'routine' || !item.parameters) continue;
    const input = item.parameters.slice(0, item.directArguments);
    const star = item.category === 'a' && item.parameters.length === 0;
    const count = star ? 1 : input.length;
    if (call.previousNames.some(name => !input.some(parameter => parameter.name === name))) continue;
    const index = call.named ? input.findIndex(parameter => parameter.name === call.named) : call.argument;
    const variadic = input.at(-1)?.mode === 'v';
    if (index < 0 || index >= count && !variadic && (count > 0 || index > 0 || !!call.named)) continue;
    let label = [item.schema, item.name].map(postgresIdentifier).join('.') + '(';
    const parameters = (star ? ['*'] : input.map(parameterLabel)).map((value, index) => {
      if (index) label += ', ';
      const start = label.length;
      label += value;
      return { label: [start, label.length] as [number, number] };
    });
    label += ')';
    if (item.directArguments !== undefined) label += ' WITHIN GROUP (ORDER BY ' + item.parameters.slice(item.directArguments).map(parameterLabel).join(', ') + ')';
    if (item.returns) label += ' → ' + item.returns;
    signatures.push({ label, parameters, activeParameter: Math.max(0, Math.min(index, count - 1)) });
  }
  return signatures.length ? { signatures, activeSignature: 0, activeParameter: signatures[0].activeParameter ?? 0 } : null;
}
