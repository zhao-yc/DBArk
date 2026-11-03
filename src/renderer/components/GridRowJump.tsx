import { useEffect, useRef, useState, type RefObject } from 'react';
import type { DataGridHandle } from 'react-data-grid';
import { gridRowJumpZh as text } from '../locales/gridRowJump.zh-CN';
import '../gridRowJump.css';

const focusedJump = new WeakMap<Element, () => void>();

/** 命令只分发给当前焦点所在的网格；编辑中的输入格不会被换焦点。 */
export function openFocusedGridRowJump(): boolean {
  const focus = document.activeElement;
  if (!focus || document.querySelector('[role="dialog"], [role="alertdialog"]')) return false;
  for (let node: Element | null = focus; node; node = node.parentElement) {
    const open = focusedJump.get(node);
    if (open) { open(); return true; }
  }
  return false;
}

/** 只接受当前显示范围内的一基行号，转换成虚拟网格使用的零基索引。 */
export function gridRowIndex(value: string, count: number): number | undefined {
  if (!/^[1-9][0-9]*$/u.test(value)) return;
  const row = Number(value);
  return Number.isSafeInteger(row) && row <= count ? row - 1 : undefined;
}

/** 行号草稿跟随一份已载入视图，切换、排序或禁用后丢弃旧输入。 */
export function GridRowJump({ scope, count, disabled, grid, onJump }: { scope: object | number; count: number; disabled?: boolean; grid: RefObject<DataGridHandle | null>; onJump(index: number): boolean }) {
  const [draft, setDraft] = useState<{ scope: object | number; value: string }>();
  const button = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null), restore = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const available = !disabled && count > 0;
  const opened = available && draft?.scope === scope;
  const index = opened ? gridRowIndex(draft.value, count) : undefined;
  useEffect(() => {
    const element = grid.current?.element, control = opened ? form.current : button.current;
    if (!element || !control) return;
    const open = () => {
      if (!available || grid.current?.element !== element) return;
      const active = document.activeElement;
      if (active && element.contains(active) && active.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
      if (opened) input.current?.focus();
      else setDraft({ scope, value: '' });
    };
    focusedJump.set(element, open); focusedJump.set(control, open);
    return () => {
      if (focusedJump.get(element) === open) focusedJump.delete(element);
      if (focusedJump.get(control) === open) focusedJump.delete(control);
    };
  });
  useEffect(() => {
    if (opened) input.current?.focus();
    else if (restore.current) { restore.current = false; button.current?.focus(); }
  }, [opened]);
  useEffect(() => { if (draft && !opened) setDraft(undefined); }, [draft, opened]);
  /** 取消时把焦点还给入口，成功则由调用方聚焦目标格。 */
  function close() { restore.current = true; setDraft(undefined); }
  return opened ? <form ref={form} className="grid-row-jump" onSubmit={event => {
    event.preventDefault();
    if (index !== undefined && onJump(index)) setDraft(undefined);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); close(); }
  }}>
    <input ref={input} aria-label={text.row} aria-invalid={!!draft.value && index === undefined} title={text.range(count)} placeholder={`1–${count}`} inputMode="numeric" value={draft.value} onChange={event => setDraft({ scope, value: event.target.value })}/>
    <button type="submit" disabled={index === undefined}>{text.go}</button>
    <button type="button" aria-label={text.close} onClick={close}>×</button>
  </form> : <button ref={button} type="button" title={text.shortcut} disabled={!available} onClick={() => setDraft({ scope, value: '' })}>{text.open}</button>;
}
