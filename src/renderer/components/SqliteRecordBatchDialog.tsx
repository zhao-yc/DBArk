import { useLayoutEffect, useRef, useState } from 'react';
import type { SqliteOriginalValue } from '../../shared/sqliteTableEdit';
import type { SqliteFillSource } from '../sqliteTableFill';
import { SqliteRecordBatch, type SqliteRecordPatch } from '../sqliteRecordBatch';
import { sqliteRecordBatchZh as text } from '../locales/sqliteRecordBatch.zh-CN';
import { SqliteTableValueDialog } from './SqliteTableEditDialog';
interface Props { ticket: object; ownerId: string; source: SqliteFillSource; current(): boolean; onSave(patches: readonly SqliteRecordPatch[]): boolean; onClose(): void; }
/** 多条记录复用完整表单／树／JSON及字节编辑；行间只保留局部输入，最后一次发布整组。 */
export function SqliteRecordBatchDialog(props: Props) {
  const owner = useRef(props).current, [session] = useState(() => new SqliteRecordBatch(owner.source)), [view, setView] = useState({ index: 0, token: {} }), live = useRef(view); live.current = view;
  const invalid = useRef(false), propsInvalid = useRef(false), closed = useRef(false), notified = useRef(false), saving = useRef(false), mounted = useRef(true), committed = useRef<object | undefined>(undefined), render = {};
  if (owner.ticket !== props.ticket || owner.ownerId !== props.ownerId || owner.source !== props.source) propsInvalid.current = true;
  /** 原来源失效永久保留，旧行组件的save／close不能清除后来行的缓冲。 */
  function current(): boolean {
    if (!invalid.current) try { if (propsInvalid.current || !owner.current() || !session.current()) invalid.current = true; } catch { invalid.current = true; }
    return mounted.current && !closed.current && !invalid.current && live.current === view;
  }
  function move(direction: -1 | 1, values?: (SqliteOriginalValue | undefined)[]): boolean {
    if (saving.current || committed.current !== render || !current()) return false;
    const next = view.index + direction; if (!Number.isInteger(next) || next < 0 || next >= owner.source.selected.length) return false;
    session.keep(view.index, values); if (!current()) return false;
    const value = { index: next, token: {} }; live.current = value; setView(value); return true;
  }
  /** 校验所有行后才请求父级一次暂存；父级失败不会消费当前表单，可修正后重新确认。 */
  function save(values: (SqliteOriginalValue | undefined)[]): boolean {
    if (saving.current || committed.current !== render || !current()) return false; saving.current = true;
    try { const patches = session.patches(view.index, values); if (!current()) throw Error(text.stale); if (!owner.onSave(patches)) return false; closed.current = true; return true; }
    finally { saving.current = false; }
  }
  /** 失效仍可明确取消自己的窗口；旧行／旧ticket和卸载后的关闭无权接管新输入。 */
  function close(): void { if (notified.current || !mounted.current || propsInvalid.current || live.current !== view || saving.current) return; notified.current = true; closed.current = true; owner.onClose(); }
  useLayoutEffect(() => { mounted.current = true; committed.current = render; return () => { if (committed.current === render) committed.current = undefined; mounted.current = false; }; });
  return <SqliteTableValueDialog key={view.index} ticket={view.token} page={owner.source.page} row={session.row(view.index)} batch={{ ownerId: owner.ownerId, position: view.index + 1, count: owner.source.selected.length }} navigation={{ ownerId: owner.ownerId, previous: view.index > 0, next: view.index + 1 < owner.source.selected.length, move }} current={current} onSave={save} onClose={close}/>;
}
