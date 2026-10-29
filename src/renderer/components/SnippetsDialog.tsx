import { useEffect, useRef, useState } from 'react';
import type { SqlSnippet } from '../../shared/contracts';
import { SNIPPET_LIMITS } from '../../shared/snippets';
import { zh, formatText } from '../locales/zh-CN';
import { errorMessage, invoke, uid } from '../lib';
import { ErrorBox, Field, Modal, UsageHelp } from './ui';
import { SqlEditor } from './SqlEditor';
import { SnippetTransferPanel } from './SnippetTransferPanel';
import '../snippets.css';

/** 内置模板由项目独立编写，不绑定服务器、不使用参数替换语法。 */
const templates: SqlSnippet[] = [
  { id: 'builtin-select', name: zh.snippets.selectColumns, group: zh.snippets.builtin, description: zh.snippets.selectDescription, sql: 'SELECT `id`, `name`\nFROM `your_table`\nWHERE `id` > 0\nORDER BY `id`\nLIMIT 100;', updatedAt: '' },
  { id: 'builtin-count', name: zh.snippets.countName, group: zh.snippets.builtin, description: zh.snippets.countDescription, sql: 'SELECT `category`, COUNT(*) AS `record_count`\nFROM `your_table`\nGROUP BY `category`\nORDER BY `record_count` DESC;', updatedAt: '' },
  { id: 'builtin-explain', name: zh.snippets.explainName, group: zh.snippets.builtin, description: zh.snippets.explainDescription, sql: 'EXPLAIN\nSELECT *\nFROM `your_table`\nWHERE `id` = 1;', updatedAt: '' }
];
/** 新片段使用独立 ID，同名副本不会覆盖原记录。 */
const blank = (): SqlSnippet => ({ id: uid(), name: '', group: '', description: '', sql: '', updatedAt: '' });

/** 模态内管理独立片段记录，预览或编辑均不会打开数据库会话。 */
export function SnippetsDialog({ initialSql, onInsert, onClose }: { initialSql: string; onInsert: (sql: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<SqlSnippet[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [search, setSearch] = useState(''); const [group, setGroup] = useState(''); const [selected, setSelected] = useState<SqlSnippet | null>(null);
  const [draft, setDraft] = useState<SqlSnippet | null>(null); const original = useRef(''); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null); const pending = useRef<() => void>(() => {});
  const confirmPanel = useRef<HTMLDivElement>(null);
  const [transferActive, setTransferActive] = useState(false);
  useEffect(() => { let alive = true; void invoke('snippets.list', {}).then(rows => { if (alive) setItems(rows); }).catch(reason => { if (alive) setError(errorMessage(reason)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, []);
  useEffect(() => {
    /** 抢先吞掉执行和保存快捷键，避免原生菜单或后台编辑器被触发。 */
    const block = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) { event.preventDefault(); event.stopImmediatePropagation(); } };
    document.addEventListener('keydown', block, true); return () => document.removeEventListener('keydown', block, true);
  }, []);
  useEffect(() => {
    if (!confirm) return;
    // 确认区可能在滚动内容下方，出现时立即展示并聚焦保守的取消按钮。
    confirmPanel.current?.scrollIntoView({ block: 'nearest' }); confirmPanel.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [confirm]);
  const dirty = draft !== null && JSON.stringify(draft) !== original.current;
  /** 切换、关闭及插入前明确处理尚未保存的编辑，不静默丢失正文。 */
  function navigate(action: () => void) { if (busy || confirm || transferActive) return; if (dirty) { pending.current = action; setConfirm('discard'); } else action(); }
  function start(value: SqlSnippet) { original.current = JSON.stringify(value); setDraft(value); setError(''); }
  /** 只有真实保存成功才更新列表并退出编辑，失败保留输入。 */
  async function save() { if (!draft || busy) return; setBusy(true); setError(''); try { const saved = await invoke('snippets.save', draft); setItems(previous => [saved, ...previous.filter(item => item.id !== saved.id)]); setSelected(saved); setDraft(null); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); } }
  /** 删除失败保留记录与当前选择，可继续修改或重试。 */
  async function remove() { if (!selected || busy) return; setBusy(true); setError(''); try { await invoke('snippets.delete', { id: selected.id }); setItems(previous => previous.filter(item => item.id !== selected.id)); setSelected(null); setDraft(null); setConfirm(null); } catch (reason) { setError(errorMessage(reason)); setConfirm(null); } finally { setBusy(false); } }
  const all = [...items, ...templates]; const groups = [...new Set(all.map(item => item.group))].sort(); const needle = search.toLocaleLowerCase();
  const visible = all.filter(item => (!group || item.group === group.slice(1)) && [item.name, item.description, item.sql, item.group].some(text => text.toLocaleLowerCase().includes(needle)));
  const builtIn = selected !== null && templates.includes(selected);
  const view = draft ?? selected;
  return <Modal title={zh.snippets.title} wide onClose={() => { if (!confirm) navigate(onClose); }}><div className="modal-content snippets-content">
    <UsageHelp><p>{zh.snippets.hint}</p></UsageHelp><div className="snippet-filters"><input aria-label={zh.snippets.search} placeholder={zh.snippets.search} value={search} onChange={event => setSearch(event.target.value)}/><select aria-label={zh.snippets.groupFilter} value={group} onChange={event => setGroup(event.target.value)}><option value="">{zh.snippets.allGroups}</option>{groups.map(value => <option key={value} value={':' + value}>{value || zh.snippets.ungrouped}</option>)}</select><button disabled={transferActive || busy || loading} onClick={() => navigate(() => { setSelected(null); start({ ...blank(), sql: initialSql }); })}>{zh.snippets.new}</button></div>
    <SnippetTransferPanel blocked={busy || !!confirm || loading} authorize={action => navigate(() => { setDraft(null); action(); })} onActive={setTransferActive} onApplied={rows => { setItems(rows); setSelected(null); setDraft(null); }}/><ErrorBox message={error}/><div className="snippet-layout"><div className="snippet-list" aria-label={zh.snippets.title}>{loading ? <p>{zh.snippets.loading}</p> : visible.length === 0 ? <p>{zh.snippets.empty}</p> : visible.map(item => <button key={`${templates.includes(item) ? 'template' : 'user'}:${item.id}`} aria-label={formatText(zh.snippets.selectName, item.name)} aria-pressed={selected?.id === item.id} onClick={() => navigate(() => { setSelected(item); setDraft(null); setError(''); })}><strong>{item.name}</strong><small>{templates.includes(item) ? zh.snippets.builtin : `${zh.snippets.user} · ${item.group || zh.snippets.ungrouped}`}</small></button>)}</div>
    <div className="snippet-details">{view && <>{draft ? <><Field label={zh.snippets.name}><input maxLength={SNIPPET_LIMITS.name} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })}/></Field><Field label={zh.snippets.group}><input maxLength={SNIPPET_LIMITS.group} value={draft.group} onChange={event => setDraft({ ...draft, group: event.target.value })}/></Field><Field label={zh.snippets.description}><textarea maxLength={SNIPPET_LIMITS.description} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })}/></Field><Field label={zh.snippets.sql}><textarea className="snippet-source" spellCheck={false} value={draft.sql} maxLength={SNIPPET_LIMITS.sql} onChange={event => setDraft({ ...draft, sql: event.target.value })}/></Field></> : <><h3>{view.name}</h3><p>{view.group || zh.snippets.ungrouped}</p><p className="snippet-description">{view.description}</p><SqlEditor value={view.sql} readOnly height={260}/></>}</>}</div></div>
    {confirm && <div ref={confirmPanel} className="snippet-confirm" role="alertdialog" aria-label={confirm === 'delete' ? zh.snippets.deleteTitle : zh.snippets.unsavedTitle}><p>{confirm === 'delete' ? formatText(zh.snippets.deleteConfirm, selected?.name ?? '') : zh.snippets.unsavedConfirm}</p><button disabled={busy} onClick={() => setConfirm(null)}>{zh.common.cancel}</button><button disabled={busy} onClick={() => { if (confirm === 'delete') void remove(); else { setConfirm(null); setDraft(null); pending.current(); } }}>{confirm === 'delete' ? zh.common.delete : zh.snippets.discard}</button></div>}
  </div><footer className="modal-footer">{draft ? <button className="primary" disabled={transferActive || busy || !!confirm || !draft.name.trim() || !draft.sql.trim()} onClick={() => void save()}>{zh.common.save}</button> : selected && <><button disabled={transferActive || busy || !!confirm} onClick={() => start({ ...selected, id: uid(), updatedAt: '' })}>{zh.snippets.copy}</button>{!builtIn && <><button disabled={transferActive || busy || !!confirm} onClick={() => start({ ...selected })}>{zh.snippets.edit}</button><button disabled={transferActive || busy || !!confirm} onClick={() => setConfirm('delete')}>{zh.common.delete}</button></>}<button className="primary" disabled={transferActive || busy || !!confirm} onClick={() => { try { onInsert(selected.sql); } catch (reason) { setError(errorMessage(reason)); } }}>{zh.snippets.insert}</button></>}<span className="grow"/><button disabled={transferActive || busy || !!confirm} onClick={() => navigate(onClose)}>{zh.common.close}</button></footer></Modal>;
}
