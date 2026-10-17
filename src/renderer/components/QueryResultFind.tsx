import { useEffect, useRef, useState, type ReactNode, type RefObject, type KeyboardEvent } from 'react';
import type { DataGridHandle } from 'react-data-grid';
import type { DataRow, ResultColumn } from '../../shared/contracts';
import { QueryResultFindScan, type QueryResultFindMatch, type QueryResultFindProgress } from '../queryResultFind';
import { queryResultFindZh as text } from '../locales/queryResultFind.zh-CN';
import '../queryResultFind.css';

interface Run { owner: object; scan: QueryResultFindScan; timer?: ReturnType<typeof setTimeout>; index: number; }
export interface QueryResultFindHit { scan: QueryResultFindScan; match: QueryResultFindMatch; }
interface Props { owner: object; rows: DataRow[]; columns: ResultColumn[]; grid: RefObject<DataGridHandle | null>; isCurrent(): boolean; onHit(hit: QueryResultFindHit | undefined): void; children: ReactNode; }

/** 查找栏与快捷键仅包住当前结果Grid；私有代次负责取消，绝不注册全局快捷键。 */
export function QueryResultFind({ owner, rows, columns, grid, isCurrent, onHit, children }: Props) {
  const latest = useRef({ owner, rows, columns, isCurrent }); latest.current = { owner, rows, columns, isCurrent };
  const alive = useRef(true), run = useRef<Run | undefined>(undefined), input = useRef<HTMLInputElement>(null);
  const panel = useRef<object | undefined>(undefined), mountOwner = useRef<object | undefined>({});
  const [opened, setOpened] = useState<{ owner: object; token: object }>();
  const [query, setQuery] = useState(''), [sensitive, setSensitive] = useState(false);
  const [view, setView] = useState<{ run: Run; progress: QueryResultFindProgress; index: number }>();
  /** 原scope或父接纳门变化时仅撤销本地查找，不改变选择或业务资源。 */
  function own(): boolean { try { return alive.current && latest.current.owner === owner && latest.current.rows === rows && latest.current.columns === columns && isCurrent(); } catch { return false; } }
  function cancel() { const previous = run.current; if (!previous) return; previous.scan.cancel(); clearTimeout(previous.timer); run.current = undefined; }
  useEffect(() => { alive.current = true; mountOwner.current ??= {}; return () => { alive.current = false; mountOwner.current = undefined; cancel(); panel.current = undefined; }; }, []);
  useEffect(() => () => { if (run.current?.owner === owner) cancel(); }, [owner]);
  useEffect(() => { if (opened?.owner === owner && panel.current === opened.token && own()) input.current?.focus(); }, [opened, owner]);
  const visible = opened?.owner === owner && panel.current === opened.token;
  // 渲染本身也观察撤销，忙碌/模态等恢复后旧代次仍保持stopped。
  const active = visible && view && view.run === run.current && view.run.scan.current() ? view : undefined;
  const available = own();
  if (view?.run.owner === owner && !available) view.run.scan.cancel();
  const panelCurrent = () => visible && panel.current === opened?.token && own();

  /** 每次文字/大小写变化都消费新代次；旧定时器即使迟到也不能发布或导航。 */
  function start(value: string, caseSensitive: boolean) {
    if (!panelCurrent() || run.current !== view?.run) return;
    cancel(); setQuery(value); setSensitive(caseSensitive); onHit(undefined);
    // RDG每次render重发handle；实例以本挂载/原scope及可取得的原宿主核验，导航使用最新handle。
    const originalMount = mountOwner.current, originalElement = grid.current?.element;
    const next = { owner, index: -1 } as Run;
    next.scan = new QueryResultFindScan(rows, columns, value, caseSensitive, () => run.current === next && own() && originalMount !== undefined && mountOwner.current === originalMount && grid.current !== null && originalElement !== undefined && (originalElement === null || grid.current.element === originalElement && originalElement.ownerDocument.contains(originalElement)));
    run.current = next;
    setView({ run: next, progress: next.scan.progress(), index: -1 });
    const advance = () => {
      if (run.current !== next || !alive.current) return;
      const progress = next.scan.current() ? next.scan.step() : next.scan.progress();
      if (run.current !== next || !alive.current) return;
      setView({ run: next, progress, index: next.index });
      if (next.scan.current() && progress.phase === 'searching') next.timer = setTimeout(advance, 0);
    };
    if (value) next.timer = setTimeout(advance, 0);
  }
  function open() {
    if (!own() || !grid.current) return;
    cancel(); onHit(undefined); panel.current = {}; setOpened({ owner, token: panel.current }); setView(undefined); setQuery('');
  }
  function close() { if (!alive.current || latest.current.owner !== owner || !visible || panel.current !== opened?.token || run.current !== view?.run) return; cancel(); panel.current = undefined; setOpened(undefined); setView(undefined); onHit(undefined); }
  /** 只滚动并标记坐标，不调用setActivePosition或行选择，不改变复制/导出所选行。 */
  function navigate(direction: -1 | 1) {
    if (!panelCurrent() || !active || run.current !== active.run || !active.run.scan.current()) return;
    const progress = active.run.scan.progress(); if (!progress.count) return;
    const index = active.run.index < 0 ? direction === 1 ? 0 : progress.count - 1 : (active.run.index + direction + progress.count) % progress.count;
    const match = active.run.scan.match(index); if (!match || !grid.current || !own()) return;
    grid.current.scrollToCell({ rowIdx: match.row, idx: match.column + 1 });
    if (!active.run.scan.current() || run.current !== active.run) return;
    active.run.index = index; setView({ run: active.run, progress, index }); onHit({ scan: active.run.scan, match });
  }
  /** 快捷键只在本包围元素中冒泡；输入法、Alt组合及其它按键均交还原控件。 */
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.altKey || !own()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopPropagation(); if (panelCurrent()) input.current?.focus(); else open(); }
    else if (visible && event.key === 'Escape' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); event.stopPropagation(); close(); }
    else if (visible && event.target === input.current && event.key === 'Enter' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); event.stopPropagation(); navigate(event.shiftKey ? -1 : 1); }
  }
  const progress = active?.progress;
  const status = !query ? text.empty : !active ? text.stopped : progress?.phase === 'invalid' ? text.invalid : progress?.phase === 'searching' ? text.searching(progress.count, progress.scannedCells, progress.totalCells) : progress?.count ? text.count(progress.count, active.index) : text.noMatch;
  const hit = active && active.index >= 0 ? active.run.scan.match(active.index) : undefined;
  return <div className="query-result-find-region" onKeyDown={keyDown}>
    <div className="query-result-find-toolbar"><button type="button" disabled={!available} aria-expanded={!!visible} onClick={open} title="Ctrl / ⌘ + F">{text.open}</button>
      {visible && <><input ref={input} type="text" aria-label={text.input} value={query} onChange={event => start(event.target.value, sensitive)}/><label className="check"><input type="checkbox" checked={sensitive} onChange={event => start(query, event.target.checked)}/>{text.sensitive}</label><button type="button" aria-label={text.previous} disabled={!active?.progress.count || !available} onClick={() => navigate(-1)}>↑</button><button type="button" aria-label={text.next} disabled={!active?.progress.count || !available} onClick={() => navigate(1)}>↓</button><button type="button" aria-label={text.close} onClick={close}>×</button></>}
    </div>
    {visible && <div className="query-result-find-status"><span role="status" aria-live="polite">{status}</span>{hit && <span>{text.location(hit.row, hit.column)}</span>}{progress?.phase === 'limited' && <strong>{text.limited}</strong>}<span className="muted">{text.scope(rows.length, columns.length)}{text.hint}</span></div>}
    <div className="query-result-find-grid">{children}</div>
  </div>;
}
