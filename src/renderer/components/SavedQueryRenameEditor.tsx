import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { savedQueryRenameSchema, savedQueryRenameZh } from '../../shared/savedQueryRename';
import { savedQueryDuplicateName, savedQueryDuplicateZh } from '../../shared/savedQueryDuplicate';
import { ErrorBox, UsageHelp } from './ui';

export interface SavedQueryRenameOrigin { readonly id: string; readonly digest: string; readonly name: string; }
interface Props { origin: SavedQueryRenameOrigin; busy: boolean; mode?: 'rename' | 'duplicate'; onConfirm(name: string): void; onCancel(): void; }

/** 单个保存名称的内联草稿；只提交原文名称，不读SQL、不抢占父列表请求或直接调用IPC。 */
export function SavedQueryRenameEditor({ origin, busy, mode = 'rename', onConfirm, onCancel }: Props) {
  const text = mode === 'duplicate' ? savedQueryDuplicateZh : savedQueryRenameZh;
  const initial = useRef({ origin, id: origin.id, digest: origin.digest, name: origin.name, mode });
  const [draft, setDraft] = useState(() => ({ name: mode === 'duplicate' ? savedQueryDuplicateName(origin.name) : origin.name })), live = useRef(draft);
  const [composing, setComposing] = useState(false), composition = useRef(false), [finished, setFinished] = useState(false);
  const alive = useRef(false), dead = useRef(false), submitted = useRef(false), committed = useRef<object | undefined>(undefined), busyRef = useRef(busy);
  const ticket = {}; busyRef.current = busy; live.current = draft;
  const input = useRef<HTMLInputElement>(null);
  /** 编辑区位于有界列表后方；明确打开后聚焦并滚到新名称，不改变原查询编辑器。 */
  useLayoutEffect(() => { input.current?.focus(); input.current?.scrollIntoView?.({ block: 'nearest' }); }, []);
  // 观察到一次来源替换或同对象字段漂移就永久撤销；恢复旧props不能复活原草稿。
  const original = initial.current;
  if (mode !== original.mode || origin !== original.origin || origin.id !== original.id || origin.digest !== original.digest || origin.name !== original.name) dead.current = true;
  useLayoutEffect(() => {
    alive.current = true; committed.current = ticket;
    return () => { alive.current = false; if (committed.current === ticket) committed.current = undefined; };
  });
  /** 每个事件属于本次已提交渲染与准确草稿；同步字段更新也立即消费旧闭包。 */
  function current(): boolean {
    if (mode !== original.mode || origin !== original.origin || origin.id !== original.id || origin.digest !== original.digest || origin.name !== original.name) dead.current = true;
    return alive.current && !dead.current && !busyRef.current && !submitted.current && committed.current === ticket && live.current === draft;
  }
  /** 输入保留有效Unicode和原空白，不trim、不合并同名查询；schema承担名称校验。 */
  function change(name: string): void { if (!current()) return; const next = { name }; live.current = next; setDraft(next); }
  /** 原schema与同步提交门共同防止无变化、组合输入、无效名称及同栈双击。 */
  function confirm(): void {
    if (!current() || composition.current || (mode === 'rename' && draft.name === original.name)) return;
    const parsed = savedQueryRenameSchema.safeParse({ id: original.id, digest: original.digest, name: draft.name });
    if (!parsed.success) return;
    submitted.current = true; setFinished(true); onConfirm(parsed.data.name);
  }
  /** 取消只消费本编辑器；不关闭父Modal，也不允许旧回调取消后来草稿。 */
  function cancel(): void { if (!current()) return; submitted.current = true; setFinished(true); onCancel(); }
  /** 组合状态同步记录，防止React提交前的Enter或旧确认按钮穿透。 */
  function compose(value: boolean): void { if (!current()) return; composition.current = value; setComposing(value); }
  /** Escape与Enter停在此编辑区；IME的229/原生组合标志不被误认为明确提交。 */
  function keyDown(event: KeyboardEvent<HTMLElement>): void {
    if (composition.current || event.nativeEvent.isComposing || event.keyCode === 229) { if (event.key === 'Enter' || event.key === 'Escape') event.stopPropagation(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    else if (event.key === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      if (!event.nativeEvent.isComposing && event.keyCode !== 229 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) confirm();
    }
  }
  const parsed = savedQueryRenameSchema.safeParse({ id: original.id, digest: original.digest, name: draft.name });
  const disabled = busy || finished || dead.current;
  return <section className="saved-query-organization-editor saved-query-rename-editor" role="group" aria-label={text.rename} onKeyDown={keyDown}>
    <h3>{text.rename}</h3><p>{original.name}</p><UsageHelp><p>{text.hint}</p></UsageHelp>
    <label>{text.newName}<input ref={input} aria-label={text.newName} maxLength={256} value={draft.name} disabled={disabled} onChange={event => change(event.target.value)} onCompositionStart={() => compose(true)} onCompositionEnd={() => compose(false)}/></label>
    <ErrorBox message={dead.current ? text.stale : !parsed.success ? text.invalidName : undefined}/>
    <footer><button type="button" disabled={disabled} onClick={cancel}>{text.cancel}</button><span className="grow"/><button type="button" className="primary" disabled={disabled || composing || !parsed.success || (mode === 'rename' && draft.name === original.name)} onClick={confirm}>{text.confirm}</button></footer>
  </section>;
}
