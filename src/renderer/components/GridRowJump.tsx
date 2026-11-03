import { useEffect, useRef, useState } from 'react';
import { gridRowJumpZh as text } from '../locales/gridRowJump.zh-CN';
import '../gridRowJump.css';

/** 只接受当前显示范围内的一基行号，转换成虚拟网格使用的零基索引。 */
export function gridRowIndex(value: string, count: number): number | undefined {
  if (!/^[1-9][0-9]*$/u.test(value)) return;
  const row = Number(value);
  return Number.isSafeInteger(row) && row <= count ? row - 1 : undefined;
}

/** 行号草稿跟随一份已载入视图，切换、排序或禁用后丢弃旧输入。 */
export function GridRowJump({ scope, count, disabled, onJump }: { scope: object | number; count: number; disabled?: boolean; onJump(index: number): boolean }) {
  const [draft, setDraft] = useState<{ scope: object | number; value: string }>();
  const button = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null), restore = useRef(false);
  const available = !disabled && count > 0;
  const opened = available && draft?.scope === scope;
  const index = opened ? gridRowIndex(draft.value, count) : undefined;
  useEffect(() => {
    if (opened) input.current?.focus();
    else if (restore.current) { restore.current = false; button.current?.focus(); }
  }, [opened]);
  useEffect(() => { if (draft && !opened) setDraft(undefined); }, [draft, opened]);
  /** 取消时把焦点还给入口，成功则由调用方聚焦目标格。 */
  function close() { restore.current = true; setDraft(undefined); }
  return opened ? <form className="grid-row-jump" onSubmit={event => {
    event.preventDefault();
    if (index !== undefined && onJump(index)) setDraft(undefined);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); close(); }
  }}>
    <input ref={input} aria-label={text.row} aria-invalid={!!draft.value && index === undefined} title={text.range(count)} placeholder={`1–${count}`} inputMode="numeric" value={draft.value} onChange={event => setDraft({ scope, value: event.target.value })}/>
    <button type="submit" disabled={index === undefined}>{text.go}</button>
    <button type="button" aria-label={text.close} onClick={close}>×</button>
  </form> : <button ref={button} type="button" disabled={!available} onClick={() => setDraft({ scope, value: '' })}>{text.open}</button>;
}
