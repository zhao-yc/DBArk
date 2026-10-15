import { boundedUtf8Bytes } from './jsonLexicalTree';

export interface TextInputBudget { readonly units: number; readonly bytes: number; readonly message: string }

/** 完整候选同时计 UTF-16 与 UTF-8，不截取、不规范化换行或修补 Unicode。 */
export function assertTextInputBudget(value: string, budget: TextInputBudget): void {
  if (value.length > budget.units || boundedUtf8Bytes(value, budget.bytes) === undefined) throw Error(budget.message);
}

/** 使用真实文本域选区；拼接前检查代码单元上限，拼接后按完整 Unicode 边界计字节。 */
export function replaceBoundedTextInput(current: string, start: number, end: number, inserted: string, budget: TextInputBudget): string {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > current.length) throw Error('输入选区已变化，请重新选择后再输入。');
  if (current.length - (end - start) + inserted.length > budget.units) throw Error(budget.message);
  const next = current.slice(0, start) + inserted + current.slice(end);
  assertTextInputBudget(next, budget); return next;
}
