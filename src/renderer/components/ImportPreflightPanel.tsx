import { useLayoutEffect, useRef, useState } from 'react';
import { ImportPreflightController, type ImportPreflightServices, type ImportPreflightSource, type ImportPreflightState } from '../importPreflight';
import type { FileImportPreflightReport } from '../../shared/fileImportPreflight';
import { importPreflightZh as text } from '../locales/importPreflight.zh-CN';

export type { ImportPreflightServices, ImportPreflightSource } from '../importPreflight';
export interface ImportPreflightPanelProps {
  source: ImportPreflightSource | null;
  busy: boolean;
  onActivity(delta: 1 | -1): void;
  onReport?(source: ImportPreflightSource, report: FileImportPreflightReport | null): void;
  services: ImportPreflightServices;
}

/** 只展示当前来源的有界报告；按钮复用同一控制器的原任务占用，不自动导入。 */
export function ImportPreflightPanel({ source, busy, onActivity, onReport, services }: ImportPreflightPanelProps) {
  const controller = useRef<ImportPreflightController | null>(null);
  const callbacks = useRef({ onActivity, onReport }); callbacks.current = { onActivity, onReport };
  const [state, setState] = useState<ImportPreflightState>({ generation: 0, report: null, phase: 'idle', message: '' });
  const [page, setPage] = useState(0);
  useLayoutEffect(() => {
    // 获取采用最新表单守卫，释放配对原获取方；父重渲染不重建或撤销正在运行的控制器。
    let acquiredBy: ImportPreflightPanelProps['onActivity'] | undefined;
    const activity = (delta: 1 | -1) => {
      if (delta === 1) { const callback = callbacks.current.onActivity; callback(1); acquiredBy = callback; }
      else { const callback = acquiredBy; acquiredBy = undefined; callback?.(-1); }
    };
    const instance = new ImportPreflightController(services, activity, setState, (owner, report) => callbacks.current.onReport?.(owner, report));
    controller.current = instance; setState(instance.state); instance.setSource(source);
    return () => { instance.dispose(); if (controller.current === instance) controller.current = null; };
  }, [services]);
  useLayoutEffect(() => { controller.current?.setSource(source); setPage(0); }, [source]);
  const report = state.report, working = state.phase !== 'idle', pages = Math.max(1, Math.ceil((report?.issues.length ?? 0) / 20)), currentPage = Math.min(page, pages - 1);
  const generation = state.generation, instance = controller.current;
  return <section aria-label={text.title}>
    <h3>{text.title}</h3><p>{text.scope}</p><p>{text.detail}</p>
    <button type="button" disabled={!source || busy || working} onClick={() => { setPage(0); void instance?.run(generation, busy); }}>{text.run}</button>
    {state.phase === 'running' || state.phase === 'cancelling' ? <button type="button" disabled={state.phase === 'cancelling'} onClick={() => void instance?.cancel(generation)}>{text.cancel}</button> : null}
    <button type="button" disabled={!report || busy || working} onClick={() => { if (report) void instance?.export(generation, report, busy); }}>{text.export}</button>
    <p aria-live="polite">{state.message}</p>
    {report && <>
      <p>{report.complete ? text.complete : text.incomplete}{report.complete && report.issueCount === 0 ? `；${text.passed}` : ''}</p>
      <p>{text.summary(report.checkedRecords, report.validRecords, report.invalidRecords, report.issueCount, report.issues.length)}</p>
      {report.truncated && <p>{text.truncated}</p>}
      {!!report.issues.length && <><table><thead><tr><th>{text.record}</th><th>{text.source}</th><th>{text.target}</th><th>{text.code}</th><th>{text.message}</th></tr></thead><tbody>{report.issues.slice(currentPage * 20, currentPage * 20 + 20).map((issue, index) => <tr key={currentPage * 20 + index}><td>{issue.record ?? text.unavailable}</td><td>{issue.source ?? text.unavailable}</td><td>{issue.target ?? text.unavailable}</td><td>{issue.code}</td><td>{issue.message}</td></tr>)}</tbody></table>
        <button type="button" disabled={currentPage === 0 || working} onClick={() => setPage(value => Math.max(0, value - 1))}>{text.previous}</button><span>{currentPage + 1} / {pages}</span><button type="button" disabled={currentPage + 1 >= pages || working} onClick={() => setPage(value => Math.min(pages - 1, value + 1))}>{text.next}</button></>}
    </>}
  </section>;
}
