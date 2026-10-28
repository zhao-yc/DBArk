import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { savedQueryDeleteSelectedLimits, savedQueryDeleteSelectedSchema, savedQueryDeleteSelectedZh as text } from '../../shared/savedQueryDeleteSelected';
import { ErrorBox } from './ui';

export interface SavedQueryDeleteSelectedItem { readonly id: string; readonly digest: string; readonly name: string; }
interface Props { items: readonly SavedQueryDeleteSelectedItem[]; busy: boolean; onConfirm(): void; onCancel(): void; }
interface Captured { rows: SavedQueryDeleteSelectedItem[]; objects: object[]; }

/** 先安全投影展示字段，再调用真实共享schema；getter、稀疏/扩展数组和陌生容器不进入渲染。 */
function capture(items: readonly SavedQueryDeleteSelectedItem[]): Captured | undefined {
  try {
    if (!Array.isArray(items) || Object.getPrototypeOf(items) !== Array.prototype) return;
    const length = Object.getOwnPropertyDescriptor(items, 'length')?.value;
    if (!Number.isSafeInteger(length) || length < 1 || length > savedQueryDeleteSelectedLimits.selected || Reflect.ownKeys(items).length !== length + 1) return;
    const rows: SavedQueryDeleteSelectedItem[] = [], objects: object[] = [];
    const own = (value: object, key: string): unknown => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (!property?.enumerable || !Object.hasOwn(property, 'value')) throw Error(text.invalid);
      return property.value;
    };
    for (let index = 0; index < length; index++) {
      const item = own(items, String(index));
      if (!item || typeof item !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(item)) || Reflect.ownKeys(item).length !== 3) return;
      const id = own(item, 'id'), digest = own(item, 'digest'), name = own(item, 'name');
      // 旧合法记录名称仅展示，不套用重命名的新名限制，也不trim或解析SQL。
      if (typeof id !== 'string' || typeof digest !== 'string' || typeof name !== 'string' || name.length < 1 || name.length > 256) return;
      rows.push({ id, digest, name }); objects.push(item);
    }
    if (!savedQueryDeleteSelectedSchema.safeParse({ queries: rows.map(({ id, digest }) => ({ id, digest })) }).success) return;
    return { rows, objects };
  } catch { return; }
}

/** 只有完整相同来源可沿用本轮预览，字段快照不随调用方原地修改一起变化。 */
function same(left: Captured, right: Captured | undefined): boolean {
  return !!right && left.rows.length === right.rows.length && left.rows.every((item, index) => left.objects[index] === right.objects[index] && item.id === right.rows[index].id && item.digest === right.rows[index].digest && item.name === right.rows[index].name);
}

/** 完整跨页选择的内联删除预览；只调用父级明确按钮回调，不拥有IPC、SQL或删除能力。 */
export function SavedQueryDeleteSelectedPreview({ items, busy, onConfirm, onCancel }: Props) {
  const observed = capture(items), initial = useRef({ items, captured: observed }), original = initial.current;
  const dead = useRef(false), alive = useRef(false), committed = useRef<object | undefined>(undefined), busyRef = useRef(busy), submitted = useRef(false), composition = useRef(false);
  const [finished, setFinished] = useState(false), [composing, setComposing] = useState(false);
  const section = useRef<HTMLElement>(null), cancelButton = useRef<HTMLButtonElement>(null), ticket = {};
  busyRef.current = busy;
  if (items !== original.items || original.captured && !same(original.captured, observed)) dead.current = true;
  useLayoutEffect(() => {
    alive.current = true; committed.current = ticket;
    return () => { alive.current = false; if (committed.current === ticket) committed.current = undefined; };
  });
  /** 默认把焦点留在取消，Enter不会因为打开预览而直接删除；这里只滚动本section。 */
  useLayoutEffect(() => { cancelButton.current?.focus(); section.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  /** 事件再次核原数组、原对象与字段；来源ABA、忙态切换和卸载都不能借旧闭包恢复权限。 */
  function current(): boolean {
    if (items !== original.items || original.captured && !same(original.captured, capture(items))) dead.current = true;
    return alive.current && !dead.current && !busyRef.current && !submitted.current && committed.current === ticket;
  }
  /** 只由确认按钮触发；同步门先于父回调，防止同栈双击或迟到取消。 */
  function confirm(): void { if (!current() || !original.captured || composition.current) return; submitted.current = true; setFinished(true); onConfirm(); }
  /** 无效初始数据仍可取消，但旧来源事件不能关闭后来的预览。 */
  function cancel(): void { if (!current()) return; submitted.current = true; setFinished(true); onCancel(); }
  /** 同步记录组合状态，Escape留给输入法；此组件不模拟父Modal的document捕获。 */
  function compose(value: boolean): void { if (!current()) return; composition.current = value; setComposing(value); }
  /** Escape仅取消预览；Enter只保留按钮自身行为，不创建删除快捷入口。 */
  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (composition.current || event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Escape' || event.key === 'Enter') event.stopPropagation(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    // 不从Enter调用confirm，也不preventDefault，保留按钮自身的原生键盘激活路径。
    else if (event.key === 'Enter') event.stopPropagation();
  }
  const rows = original.captured?.rows ?? [], disabled = busy || finished || dead.current;
  return <section ref={section} className="saved-query-organization-editor saved-query-delete-selected-preview" role="group" aria-label={text.title} onKeyDown={keyDown} onCompositionStart={() => compose(true)} onCompositionEnd={() => compose(false)}>
    <h3>{text.title}</h3><p>{text.hint}</p>
    <ol>{rows.map(item => <li key={item.id}><span>{item.name}</span> <code>{item.id}</code></li>)}</ol>
    <ErrorBox message={dead.current ? text.stale : !original.captured ? text.invalid : undefined}/>
    <footer><button ref={cancelButton} type="button" disabled={disabled} onClick={cancel}>{text.cancel}</button><span className="grow"/><button type="button" className="primary" disabled={disabled || composing || !original.captured} onClick={confirm}>{text.confirm(rows.length)}</button></footer>
  </section>;
}
