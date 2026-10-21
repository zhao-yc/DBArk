import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TableInfo } from '../../shared/contracts';
import { buildTableQueryTemplate, tableQueryTemplateKinds, type TableQueryTemplateKind } from '../tableQueryTemplate';
import { tableQueryTemplateZh as text } from '../locales/tableQueryTemplate.zh-CN';
import { ErrorBox, Field, Modal } from './ui';

/** 只预览当前结构的SQL，动作保留单次身份；不会读取数据库或操作原表页草稿。 */
export function TableQueryTemplateDialog({ info, limit, isCurrent, onOpen, onClose }: { info: TableInfo; limit: number; isCurrent(): boolean; onOpen(sql: string, kind: TableQueryTemplateKind): boolean; onClose(): void }) {
  const [kind, setKind] = useState<TableQueryTemplateKind>('SELECT'), [error, setError] = useState('');
  const live = useRef<object | null>(null), consumed = useRef(false), invalid = useRef(false), ticket = {};
  useLayoutEffect(() => { live.current = ticket; return () => { if (live.current === ticket) live.current = null; }; });
  const preview = useMemo(() => { try { return { value: buildTableQueryTemplate(info, kind, limit), error: '' }; } catch (reason) { return { value: undefined, error: reason instanceof Error ? reason.message : text.invalid }; } }, [info, kind, limit]);
  /** 每个事件核原窗口及上层结构租约；失效不会因选回原类型而复活。 */
  function current(): boolean { if (invalid.current || consumed.current || live.current !== ticket) return false; let valid = false; try { const dialogs = document.querySelectorAll('[role="dialog"]'); valid = isCurrent() && dialogs.length === 1 && dialogs[0].getAttribute('aria-label') === text.title; } catch {} if (!valid) { invalid.current = true; setError(text.changed); } return valid; }
  /** 原子消费打开动作；拒绝或错误在本窗口明确显示，不生成第二个查询。 */
  function open(): void { if (!current() || !preview.value) return; consumed.current = true; try { if (!onOpen(preview.value.sql, kind)) { invalid.current = true; setError(text.changed); } } catch (reason) { consumed.current = false; setError(reason instanceof Error ? reason.message : text.changed); } }
  return <Modal title={text.title} wide onClose={onClose}><div className="modal-content"><p className="muted">{text.hint}</p><Field label={text.kind}><select aria-label={text.kind} value={kind} onChange={event => { if (!current() || !tableQueryTemplateKinds.includes(event.target.value as TableQueryTemplateKind)) return; setKind(event.target.value as TableQueryTemplateKind); setError(''); }}>{tableQueryTemplateKinds.map(value => <option key={value} value={value}>{value}</option>)}</select></Field>{preview.value && <><p>{preview.value.parameters ? text.parameters(preview.value.parameters) : kind === 'SELECT' ? text.selectHint : text.noParameters}</p><pre className="sql-preview" aria-label={text.preview}>{preview.value.sql}</pre></>}<ErrorBox message={error || preview.error}/></div><footer className="modal-footer"><button onClick={onClose}>{text.close}</button><span className="grow"/><button className="primary" disabled={!preview.value || !!error} onClick={open}>{text.open}</button></footer></Modal>;
}
