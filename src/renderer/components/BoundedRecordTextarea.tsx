import { forwardRef, useEffect, useState, type TextareaHTMLAttributes } from 'react';
import { assertTextInputBudget, replaceBoundedTextInput, type TextInputBudget } from '../boundedTextInput';
import { errorMessage } from '../lib';
import { ErrorBox } from './ui';

interface Props extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'defaultValue' | 'maxLength' | 'onChange' | 'onPaste'> {
  value: string; budget: TextInputBudget; inputIdentity: unknown; onValueChange(value: string): void;
}

/** 不使用浏览器截断上限；完整粘贴先预检，其余输入与最终缓冲共用完整预算。 */
export const BoundedRecordTextarea = forwardRef<HTMLTextAreaElement, Props>(function BoundedRecordTextarea({ value, budget, inputIdentity, onValueChange, ...attributes }, ref) {
  const [error, setError] = useState('');
  // 切换行、输入模式或节点会话时清除旧拒绝提示；同一会话失败仍保留旧合法缓冲。
  useEffect(() => { setError(''); }, [inputIdentity]);
  return <><textarea {...attributes} ref={ref} value={value} onPaste={event => {
    if (attributes.readOnly || attributes.disabled) return;
    try {
      const node = event.currentTarget;
      // 选区以原生文本域为准，避免 CRLF 的 DOM 偏移与父缓冲原始偏移混用；不手工改写粘贴内容。
      replaceBoundedTextInput(node.value, node.selectionStart, node.selectionEnd, event.clipboardData.getData('text/plain'), budget);
    } catch (reason) { event.preventDefault(); setError(errorMessage(reason)); }
  }} onChange={event => {
    if (attributes.readOnly || attributes.disabled) return;
    const node = event.currentTarget;
    try { assertTextInputBudget(node.value, budget); onValueChange(node.value); setError(''); }
    catch (reason) { node.value = value; setError(errorMessage(reason)); }
  }}/><ErrorBox message={error}/></>;
});
