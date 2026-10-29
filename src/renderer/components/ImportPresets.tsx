import { useEffect, useRef, useState } from 'react';
import type { ImportPresetConfiguration } from '../../shared/importPresets';
import { ImportPresetsController, type ImportPresetsServices, type ImportPresetsState } from '../importPresetsUi';
import { importPresetsZh as text } from '../locales/importPresets.zh-CN';
import { invoke } from '../lib';
import { ErrorBox, Field, Spinner, UsageHelp } from './ui';
const services: ImportPresetsServices = { list: () => invoke('files.importPresets.list', {}), save: input => invoke('files.importPresets.save', input), delete: input => invoke('files.importPresets.delete', input) };
interface Props { source: string; busy: boolean; canSave: boolean; isCurrent(): boolean; capture(): ImportPresetConfiguration; onApply(value: ImportPresetConfiguration): boolean; onActivity(delta: 1 | -1): void; services?: ImportPresetsServices; }
/** 独立内联本地配置区，显式读取列表，不给旧导入默认流程增加请求。 */
export function ImportPresets(props: Props) {
  const live = useRef(props); live.current = props;
  const publish = useRef<(state: ImportPresetsState) => void>(() => {});
  const [controller] = useState(() => new ImportPresetsController({ services: props.services ?? services, source: () => live.current.source, available: () => !live.current.busy && live.current.isCurrent(), capture: () => live.current.capture(), apply: value => live.current.onApply(value), activity: delta => live.current.onActivity(delta), publish: value => publish.current(value) }));
  // 首帧也使用协调器的同一原状态对象，不能另外创建副本而被真实身份门拒绝。
  const [state, setState] = useState(() => controller.state); publish.current = setState;
  useEffect(() => () => controller.dispose(), [controller]);
  const disabled = state.busy || props.busy, writable = !disabled && !state.needsRefresh && !!state.snapshot;
  return <section aria-label={text.title}><h3>{text.title}</h3><UsageHelp><p>{text.scope}</p><p>{text.explicit}</p></UsageHelp>
    <button disabled={disabled} onClick={() => void controller.load(state, props.source)}>{state.snapshot ? text.refresh : text.read}</button>
    <Field label={text.choose}><select aria-label={text.choose} value={state.selected} disabled={disabled} onChange={event => controller.select(event.target.value, state, props.source)}><option value="">{text.placeholder}</option>{state.snapshot?.entries.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></Field>
    <button disabled={!writable || !state.selected} onClick={() => controller.apply(state, props.source)}>{text.apply}</button>
    <Field label={text.name}><input aria-label={text.name} maxLength={80} value={state.name} disabled={disabled} onChange={event => controller.rename(event.target.value, state, props.source)}/></Field>
    <div className="check-row"><button disabled={!writable || !props.canSave} onClick={() => void controller.mutate('create', state, props.source)}>{text.create}</button><button disabled={!writable || !state.selected || !props.canSave} onClick={() => void controller.mutate('update', state, props.source)}>{text.update}</button><button disabled={!writable || !state.selected} onClick={() => void controller.mutate('delete', state, props.source)}>{text.delete}</button></div>
    {!props.canSave && <small>{text.mapping}</small>}{state.snapshot && !state.snapshot.entries.length && <p>{text.empty}</p>}{state.busy && <Spinner text={text.loading}/>}<ErrorBox message={state.error}/>
  </section>;
}
