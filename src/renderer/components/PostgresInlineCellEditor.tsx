import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { postgresTableLimits, type PostgresTableColumn, type PostgresTableField } from '../../shared/postgresTable';
import { errorMessage } from '../lib';
import { postgresTableZh as text } from '../locales/postgresTable.zh-CN';
import { ErrorBox } from './ui';

export type PostgresInlineCellValue = Exclude<PostgresTableField['value'], { mode: 'binary' }>;

/** 编辑器贴在原格上方，输入只在内存保留，明确暂存才进入记录草稿。 */
export function PostgresInlineCellEditor({ anchor, column, originalText, initial, typed, visible, onStage, onCancel }: {
  anchor: HTMLElement; column: PostgresTableColumn; originalText: string; initial: PostgresInlineCellValue;
  typed?: string; visible: boolean; onStage(value: PostgresInlineCellValue): void; onCancel(): void;
}) {
  const [mode, setMode] = useState<PostgresInlineCellValue['mode']>(typed === undefined ? initial.mode : 'text');
  const [value, setValue] = useState(typed ?? (initial.mode === 'text' ? initial.value : originalText));
  const [error, setError] = useState('');
  const panel = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const modeSelect = useRef<HTMLSelectElement>(null);
  const composing = useRef(false);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!visible || !element) return;
    const position = () => {
      const rect = anchor.getBoundingClientRect(), size = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - size.width - 8))}px`;
        element.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - size.height - 8))}px`;
      }
    };
    position();
    if (input.current) {
      input.current.focus({ preventScroll: true });
      if (typed === undefined) input.current.select();
      else input.current.setSelectionRange(input.current.value.length, input.current.value.length);
    } else modeSelect.current?.focus({ preventScroll: true });
    const resize = new ResizeObserver(position);
    resize.observe(element);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    return () => {
      composing.current = false;
      resize.disconnect();
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
    };
  }, [anchor, typed, visible]);

  function stage() {
    if (!visible || composing.current) return;
    try { onStage(mode === 'text' ? { mode, value } : { mode }); }
    catch (reason) { setError(errorMessage(reason)); }
  }

  return createPortal(<form ref={panel} className="pg-inline-cell-editor" role="region" hidden={!visible}
    aria-label={text.cellEdit(column.name)} onSubmit={event => { event.preventDefault(); stage(); }}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || composing.current || event.repeat) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
      if (event.key === 'Enter' && event.target === input.current && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        stage();
      }
    }}>
    <label><span title={column.name}>{column.name}</span>
      <select ref={modeSelect} aria-label={text.valueMode} value={mode} onChange={event => {
        setMode(event.target.value as PostgresInlineCellValue['mode']);
        setError('');
      }}>
        <option value="text">{text.text}</option>
        {column.nullable && <option value="null">{text.null}</option>}
        <option value="default">{text.default}</option>
      </select>
    </label>
    {mode === 'text' && <textarea ref={input} rows={2} aria-label={text.value} value={value} maxLength={postgresTableLimits.value}
      onChange={event => { setValue(event.target.value); setError(''); }}/>}
    <ErrorBox message={error}/>
    <div className="pg-inline-cell-actions">
      <button type="button" onClick={onCancel}>{text.cancel}</button>
      <button type="submit" className="primary">{text.stage}</button>
    </div>
  </form>, document.body);
}
