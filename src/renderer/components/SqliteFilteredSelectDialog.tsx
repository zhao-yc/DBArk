import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SqliteFilteredSelectIntent, SqliteFilteredSelectPlan } from '../sqliteFilteredSelectUi';
import { sqliteFilteredSelectZh as text } from '../locales/sqliteFilteredSelect.zh-CN';
import { ErrorBox, Modal } from './ui';

interface Props { intent: SqliteFilteredSelectIntent; ownerId: string; onOpen(plan: SqliteFilteredSelectPlan): boolean; onClose(): void; }
interface Draft { order: string[]; selected: ReadonlySet<string>; limited: boolean; limit: string; revision: object; inputEpoch: object; plan?: SqliteFilteredSelectPlan; error: string; }
/** 实时预览只调用有界纯编译器；不读取原行、不消费plan或执行SQL，准确计划仅交父页面一次。 */
export function SqliteFilteredSelectDialog({ intent, ownerId, onOpen, onClose }: Props) {
  const owner = useRef({ intent, ownerId, onOpen, onClose }).current;
  const propsInvalid = useRef(false), invalid = useRef(false), closed = useRef(false), mounted = useRef(false), opening = useRef(false), attempted = useRef(new WeakSet<SqliteFilteredSelectPlan>());
  const [draft, setDraft] = useState<Draft>(() => ({ order: [...intent.columns], selected: new Set(intent.columns), limited: false, limit: String(intent.defaultLimit), revision: {}, inputEpoch: {}, error: '' })), live = useRef(draft); live.current = draft;
  const renderTicket = {}, committed = useRef<object | undefined>(undefined);
  if (owner.intent !== intent || owner.ownerId !== ownerId) propsInvalid.current = true;
  function sourceCurrent(): boolean { try { if (propsInvalid.current || !owner.intent.current()) invalid.current = true; } catch { invalid.current = true; } return !invalid.current && !closed.current; }
  function local(): boolean { return mounted.current && committed.current === renderTicket && live.current === draft && !closed.current; }
  function replace(value: Draft): void { live.current = value; setDraft(value); }
  /** 输入同步撤UI计划，effect按新revision编译一次；正文不在render中重复编译撤自己的cap。 */
  function change(value: Pick<Draft, 'order' | 'selected' | 'limited' | 'limit'>, structural: boolean): void {
    if (!mounted.current || opening.current || !sourceCurrent()) return;
    replace({ ...value, revision: {}, inputEpoch: structural ? {} : live.current.inputEpoch, error: '' });
  }
  function choose(name: string, checked: boolean): void { if (!local() || !draft.order.includes(name)) return; const selected = new Set(draft.selected); if (checked) selected.add(name); else selected.delete(name); change({ ...draft, selected }, true); }
  function all(checked: boolean): void { if (!local()) return; change({ ...draft, selected: new Set(checked ? draft.order : []) }, true); }
  function move(name: string, direction: -1 | 1): void {
    if (!local()) return; const order = [...draft.order], before = order.indexOf(name), after = before + direction;
    if (before < 0 || after < 0 || after >= order.length) return; [order[before], order[after]] = [order[after]!, order[before]!]; change({ ...draft, order }, true);
  }
  /** 数字全文事件合并最新live；模式/字段/顺序变动都会撤销旧input epoch。 */
  function changeLimit(value: string, epoch: object): void { if (!mounted.current || live.current.inputEpoch !== epoch || !live.current.limited || opening.current || !sourceCurrent()) return; change({ ...live.current, limit: value }, false); }
  function mode(limited: boolean): void { if (local()) change({ ...draft, limited }, true); }
  function limitValid(value: Draft): boolean { const limit = Number(value.limit); return !value.limited || !!value.limit.trim() && Number.isSafeInteger(limit) && limit >= 1 && limit <= 1000000; }
  /** 只交原plan一次；成功可同步激活新查询标签，绝不以post-current误判原成功。 */
  function open(): void {
    const plan = draft.plan; if (!local() || opening.current || !plan || attempted.current.has(plan)) return; opening.current = true;
    try {
      if (!sourceCurrent()) { replace({ ...draft, error: text.stale }); return; }
      attempted.current.add(plan);
      if (!owner.onOpen(plan)) { if (mounted.current) replace({ ...live.current, error: text.openFailed }); return; }
      closed.current = true; owner.onClose();
    } catch { if (mounted.current) replace({ ...live.current, error: text.openFailed }); }
    finally { opening.current = false; }
  }
  /** 来源失效仍可取消自己的窗口；误复用相同key的后继intent不能被旧close清除。 */
  function close(): void { if (!local() || propsInvalid.current || opening.current) return; closed.current = true; owner.onClose(); }
  useLayoutEffect(() => { mounted.current = true; committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; mounted.current = false; }; });
  useEffect(() => {
    const value = live.current, revision = draft.revision;
    if (!mounted.current || value.revision !== revision || !sourceCurrent()) return;
    const columns = value.order.filter(name => value.selected.has(name));
    try {
      // 即使输入无效也交纯编译边界撤销上一plan；不拼SQL或以旧预览冒充当前设计。
      const plan = owner.intent.compile(columns, value.limited ? limitValid(value) ? Number(value.limit) : Number.NaN : undefined);
      if (mounted.current && live.current.revision === revision && sourceCurrent()) replace({ ...value, plan, error: '' });
    } catch {
      if (mounted.current && live.current.revision === revision) replace({ ...value, plan: undefined, error: !columns.length ? text.empty : !limitValid(value) ? text.invalidLimit : text.invalid });
    }
  }, [draft.revision]);
  const valid = sourceCurrent(), selected = draft.order.filter(name => draft.selected.has(name)), disabled = !valid || opening.current;
  return <Modal title={text.title} wide onClose={close}><div className="dialog-body" data-sqlite-filtered-select-owner={owner.ownerId}>
    <p>{owner.intent.target.database}.{owner.intent.target.table}</p><p>{text.hint}</p><p>{text.orderHint}</p>
    <div><button type="button" disabled={disabled} onClick={() => all(true)}>{text.all}</button><button type="button" disabled={disabled} onClick={() => all(false)}>{text.none}</button></div>
    <ol aria-label={text.projection} style={{ listStyle: 'none', padding: 0, maxHeight: 248, overflow: 'auto' }}>{draft.order.map((name, index) => <li key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 31 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}><input type="checkbox" aria-label={text.choose(name)} checked={draft.selected.has(name)} disabled={disabled} onChange={event => choose(name, event.target.checked)}/><span className="sqlite-filtered-select-field-name" title={name} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span></label>
      <button type="button" aria-label={text.moveUp(name)} disabled={disabled || index === 0} onClick={() => move(name, -1)}>{text.up}</button><button type="button" aria-label={text.moveDown(name)} disabled={disabled || index === draft.order.length - 1} onClick={() => move(name, 1)}>{text.down}</button>
    </li>)}</ol><p role="status">{text.selected(selected.length)}</p><p>{text.limitHint}</p>
    <label><input type="radio" name={'sqlite-filtered-select-limit-' + owner.ownerId} aria-label={text.noLimit} checked={!draft.limited} disabled={disabled} onChange={() => mode(false)}/>{text.noLimit}</label>
    <label><input type="radio" name={'sqlite-filtered-select-limit-' + owner.ownerId} aria-label={text.limited} checked={draft.limited} disabled={disabled} onChange={() => mode(true)}/>{text.limited}</label>
    <label>{text.limit}<input type="number" aria-label={text.limit} value={draft.limit} min={1} max={1000000} step={1} disabled={disabled || !draft.limited} onChange={event => changeLimit(event.target.value, draft.inputEpoch)}/></label>
    <textarea aria-label={text.preview} readOnly value={draft.plan?.sql ?? ''} rows={10} style={{ fontFamily: 'monospace' }}/>
    <ErrorBox message={!valid ? text.stale : draft.error}/>
  </div><footer><button type="button" aria-label={text.cancel} onClick={close}>{text.cancel}</button><button type="button" className="primary" aria-label={text.open} disabled={disabled || !selected.length || !limitValid(draft) || !draft.plan || attempted.current.has(draft.plan)} onClick={open}>{text.open}</button></footer></Modal>;
}
