import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TableCreateApplyOutput } from '../../shared/tableCreate';
import { csvImportDelimiters, type CsvImportDelimiter } from '../../shared/csvImport';
import { ImportNewTableController, type ImportNewTableServices } from '../importNewTableUi';
import { cellPreview, invoke, uid } from '../lib';
import { importNewTableZh as text } from '../locales/importNewTable.zh-CN';
import { useWorkspace } from '../store';
import { SchemaDialog } from './SchemaDialog';
import { TransferDialog } from './TransferDialog';
import { ErrorBox, Field, Modal, Spinner, UsageHelp } from './ui';

export interface ImportNewTableDialogProps {
  connectionId: string; database: string; onClose(): void;
  onCreated?(result: TableCreateApplyOutput, version: number): void; onDirtyChange?(dirty: boolean): void;
  services?: ImportNewTableServices;
}
/** 文件仅经主进程签发能力，完整扫描沿真实受限命令与原task取消。 */
export const importNewTableServices: ImportNewTableServices = {
  choose: input => invoke('files.choose', input), inspect: input => invoke('files.inspectImport', input), cancel: taskId => invoke('query.cancel', { taskId }), uid,
};

/** 正式设计器和正式导入器各自保留事务/资源所有权，向导只在原关闭回应后切换阶段。 */
export function ImportNewTableDialog({ connectionId, database, onClose, onCreated, onDirtyChange, services = importNewTableServices }: ImportNewTableDialogProps) {
  const origin = useRef({ connectionId, database, services, version: useWorkspace.getState().connectionVersions[connectionId] ?? 0, connection: useWorkspace.getState().connections.find(value => value.id === connectionId), invalid: false }).current;
  const callbacks = useRef({ onClose, onCreated, onDirtyChange }); callbacks.current = { onClose, onCreated, onDirtyChange };
  const [, render] = useState(0), committed = useRef<object | undefined>(undefined);
  const [controller] = useState(() => new ImportNewTableController({ connectionId: origin.connectionId, database: origin.database, version: origin.version }, origin.services, () => !origin.invalid && (useWorkspace.getState().connectionVersions[origin.connectionId] ?? 0) === origin.version && useWorkspace.getState().connections.find(value => value.id === origin.connectionId) === origin.connection, () => render(value => value + 1), () => callbacks.current.onClose(), (result, version) => callbacks.current.onCreated?.(result, version)));
  if (origin.connectionId !== connectionId || origin.database !== database || origin.services !== services) origin.invalid = true;
  const state = controller.state, ticket = {}, lease = controller.childLease;
  const childStage = state.stage === 'design' || state.stage === 'import' ? state.stage : undefined;
  // 仅原lease或阶段变化才换守卫对象，普通重绘不能令子组件的固定父守卫误失效。
  const childCurrent = useMemo(() => () => !!lease && !!childStage && controller.isChildCurrent(lease, childStage), [controller, lease, childStage]);
  useLayoutEffect(() => { committed.current = ticket; if (origin.invalid) controller.invalidate(); return () => { if (committed.current === ticket) committed.current = undefined; }; });
  /** 所有来源配置变化直接订阅，不等待React合批后才看最终值，从而覆盖连接A→B→A。 */
  useEffect(() => {
    controller.mount();
    const observe = () => { const workspace = useWorkspace.getState(); if ((workspace.connectionVersions[origin.connectionId] ?? 0) !== origin.version || workspace.connections.find(value => value.id === origin.connectionId) !== origin.connection) { origin.invalid = true; controller.invalidate(); } };
    observe(); const unsubscribe = useWorkspace.subscribe(observe), unsubscribeTasks = window.dbark?.onTask(event => controller.progress(event));
    return () => { unsubscribe(); unsubscribeTasks?.(); controller.dispose(); callbacks.current.onDirtyChange?.(false); };
  }, []);
  useEffect(() => { callbacks.current.onDirtyChange?.(controller.dirty); }, [controller, state]);
  /** 已提交渲染身份与协调器快照共同围栏，旧DOM事件不能调用新阶段的网络入口。 */
  function event(action: () => void): void { if (committed.current === ticket && controller.state === state) action(); }
  if (state.stage === 'design' && state.design && lease) return <SchemaDialog connectionId={origin.connectionId} database={origin.database} initialDesign={state.design} invalidated={state.invalid} isParentCurrent={childCurrent} onApplied={() => undefined} onCreated={(result, version) => controller.receiveCreated(lease, result, version)} onClose={() => controller.schemaClosed(lease)} onDirtyChange={dirty => controller.childDirty(lease, dirty)}/>;
  if (state.stage === 'import' && state.seed && state.created && lease) return <TransferDialog mode="import" connectionId={origin.connectionId} database={origin.database} table={state.created.target.table} initialImport={state.seed} invalidated={state.invalid} isParentCurrent={childCurrent} onClose={() => controller.importClosed(lease)}/>;
  const disabled = state.busy || state.closing || state.invalid, inspection = state.inspection;
  return <Modal title={text.title} wide onClose={() => event(() => { void controller.close(state); })}><div className="modal-content" aria-busy={state.busy || state.closing}>
    <UsageHelp><p>{text.scope}</p><p>{text.types}</p>{inspection && <><p>{text.bytes}：{inspection.source.bytes}</p><p style={{ overflowWrap: 'anywhere' }}>{text.fingerprint}：{inspection.source.sha256}</p></>}</UsageHelp><p className="warning-text">{text.ddl}</p>
    {state.stage === 'source' ? <>
      <div className="form-grid"><Field label={text.format}><select aria-label={text.format} value={state.options.format} disabled={disabled} onChange={value => event(() => controller.change(state, { format: value.target.value as 'csv' | 'json' }))}><option value="csv">CSV</option><option value="json">JSON</option></select></Field>
        <Field label={text.encoding}><select aria-label={text.encoding} value={state.options.encoding} disabled={disabled} onChange={value => event(() => controller.change(state, { encoding: value.target.value as 'utf8' | 'utf16le' | 'gb18030' }))}><option value="utf8">UTF-8</option><option value="utf16le">UTF-16 LE</option><option value="gb18030">GB18030</option></select></Field>
        {state.options.format === 'csv' && <><Field label={text.delimiter}><select aria-label={text.delimiter} value={state.options.csvDelimiter ?? ','} disabled={disabled} onChange={value => event(() => controller.change(state, { csvDelimiter: value.target.value as CsvImportDelimiter }))}>{csvImportDelimiters.map(delimiter => <option key={delimiter} value={delimiter}>{text.separators[delimiter]}</option>)}</select></Field><label><input type="checkbox" aria-label={text.header} checked={state.options.csvHasHeader ?? true} disabled={disabled} onChange={value => event(() => controller.change(state, { csvHasHeader: value.target.checked }))}/>{text.header}</label></>}
      </div>
      <button disabled={disabled} onClick={() => event(() => { void controller.scan(state); })}>{state.busy ? <Spinner/> : null}{text.choose}</button>
      {state.file && <p>{text.source}：{state.file.name}</p>}
      {inspection && <section><p>{text.records(inspection.records)}</p><p>{text.columns}：{inspection.columns.length}</p><p>{text.sample}</p>
        <div style={{ overflow: 'auto', maxHeight: 280 }}><table><thead><tr>{inspection.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{inspection.rows.map((row, index) => <tr key={index}>{inspection.columns.map(column => <td key={column}>{cellPreview(Object.hasOwn(row, column) ? row[column] : undefined, 120)}</td>)}</tr>)}</tbody></table></div>
        {inspection.sampleOmitted && <p>{text.omitted}</p>}
        <Field label={text.table}><input aria-label={text.table} value={state.tableName} disabled={disabled} maxLength={64} onChange={value => event(() => controller.name(state, value.target.value))}/></Field><label><input type="checkbox" aria-label={text.reviewed} checked={state.reviewed} disabled={disabled || !state.tableName} onChange={value => event(() => controller.review(state, value.target.checked))}/>{text.reviewed}</label>
      </section>}
    </> : <section><h3>{text.created}</h3><p>{state.created?.target.database}.{state.created?.target.table}</p><p>{text.retained}</p>{(!state.created?.definitionVerified || !state.created.resourcesReleased) && <p className="warning-text">{text.unverified}</p>}</section>}
    {state.progress && <p role="status">{state.progress.message} · {state.progress.progress}%</p>}
    <ErrorBox message={state.invalid ? text.stale : state.error ?? ''}/>
  </div><footer className="modal-footer"><button disabled={state.closing} onClick={() => event(() => { void controller.close(state); })}>{state.closing ? text.closing : text.close}</button><span className="grow"/>{state.busy && <button disabled={state.closing} onClick={() => event(() => controller.cancel())}>{text.cancel}</button>}{state.stage === 'source' ? <button className="primary" disabled={disabled || !inspection || !state.reviewed || !state.tableName} onClick={() => event(() => { controller.design(state); })}>{text.design}</button> : <button className="primary" disabled={disabled || !state.created?.definitionVerified || !state.created.resourcesReleased} onClick={() => event(() => controller.continue(state))}>{text.continue}</button>}</footer></Modal>;
}
