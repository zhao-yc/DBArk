import { useLayoutEffect, useRef, useState } from 'react';
import type { SqliteTablePage } from '../../shared/sqliteTableBrowse';
import { sqliteEditValueSchema, sqliteTableEditLimits } from '../../shared/sqliteTableEdit';
import { sqliteFillSourceLimits, type SqliteFillField } from '../sqliteTableFill';
import { sqliteTableFillZh as text } from '../locales/sqliteTableFill.zh-CN';
import { ErrorBox, Modal } from './ui';

interface Props {
  ticket: object; ownerId: string; page: SqliteTablePage; count: number; allNew: boolean; current(): boolean;
  onSave(fields: readonly SqliteFillField[]): boolean; onClose(): void;
}
type FillKind = keyof typeof text.kinds;
interface FieldDraft { include: boolean; kind: FillKind; value: string; epoch: object; }
interface Draft { fields: FieldDraft[]; }
/** 勾选记录只接相同typed字段赋值；所有字段初始不选，绝不读取原行值或借预览执行SQL。 */
export function SqliteTableFillDialog({ ticket, ownerId, page, count, allNew, current, onSave, onClose }: Props) {
  const owner = useRef({ ticket, ownerId, page, count, allNew, current, onSave, onClose }).current;
  const invalid = useRef(false), propsInvalid = useRef(false), closed = useRef(false), mounted = useRef(false), saving = useRef(false), attempted = useRef(new WeakSet<Draft>());
  /** 目录快照仅含目标与字段能力，不读取edit.rows中的原数据。 */
  function metadata(): string { const edit = owner.page.edit; return JSON.stringify([owner.page.target, owner.page.schemaKey, owner.page.columns, edit?.kind === 'editable' ? [edit.kind, edit.snapshotId, edit.expiresAt, edit.columns, edit.locator] : edit?.kind]); }
  const [source] = useState(() => {
    try {
      const edit = owner.page.edit;
      const valid = edit?.kind === 'editable' && owner.page.target.kind === 'table' && owner.page.target.database === 'main' && edit.columns.length > 0 && edit.columns.length <= 1024 && edit.columns.length === owner.page.columns.length && edit.columns.every((column, index) => column.name === owner.page.columns[index].name && column.generated === !!owner.page.columns[index].generated);
      return { signature: metadata(), columns: valid && edit?.kind === 'editable' ? edit.columns.map((column, index) => ({ ...column, index })).filter(column => !column.generated) : [] };
    } catch { return { signature: '', columns: [] }; }
  });
  const [draft, setDraft] = useState<Draft>(() => ({ fields: source.columns.map(() => ({ include: false, kind: 'text' as const, value: '', epoch: {} })) })), live = useRef(draft); live.current = draft;
  const [error, setError] = useState(''), renderTicket = {}, committed = useRef<object | undefined>(undefined);
  if (owner.ticket !== ticket || owner.ownerId !== ownerId || owner.page !== page || owner.count !== count || owner.allNew !== allNew) propsInvalid.current = true;
  function sourceCurrent(): boolean { try { if (propsInvalid.current || source.signature !== metadata() || !owner.current()) invalid.current = true; } catch { invalid.current = true; } return !invalid.current && !closed.current; }
  function local(): boolean { return mounted.current && committed.current === renderTicket && live.current === draft && !closed.current; }
  function inputCurrent(index: number, epoch: object): boolean { return mounted.current && !saving.current && countValid && !!source.columns.length && sourceCurrent() && live.current.fields[index]?.epoch === epoch; }
  function replace(value: Draft): void { live.current = value; setDraft(value); setError(''); }
  /** checkbox/类型走本render门；正文走准确字段epoch以保同一轮连续全文输入。 */
  function change(index: number, patch: Partial<Pick<FieldDraft, 'include' | 'kind' | 'value'>>, epoch: object, structural: boolean): void {
    if (structural && !local() || !inputCurrent(index, epoch)) return;
    const before = live.current.fields[index];
    if (patch.kind !== undefined && !before.include || patch.value !== undefined && (!before.include || before.kind === 'null' || before.kind === 'default')) return;
    if (patch.kind !== undefined && (!Object.hasOwn(text.kinds, patch.kind) || patch.kind === 'default' && !owner.allNew)) return;
    const value = live.current;
    replace({ fields: value.fields.map((field, at) => at === index ? { ...field, ...patch, epoch: structural ? {} : field.epoch } : field) });
  }
  const countValid = Number.isSafeInteger(owner.count) && owner.count > 0 && owner.count <= sqliteFillSourceLimits.rows && typeof owner.allNew === 'boolean' && typeof owner.ownerId === 'string' && owner.ownerId.length > 0;
  /** 在解析前按字段×行数估算；最终完整草稿、原值和写入预算仍由editor正式复核。 */
  function budget(value: Draft): string {
    const chosen = value.fields.filter(field => field.include); if (!chosen.length) return text.empty;
    if (!countValid) return text.invalid;
    if (chosen.length * owner.count > sqliteTableEditLimits.cells) return text.budget;
    let units = 0;
    for (let index = 0; index < value.fields.length; index++) {
      const field = value.fields[index]; if (!field.include) continue;
      if (field.kind !== 'null' && field.kind !== 'default' && field.value.length > sqliteTableEditLimits.valueUnits) return text.budget;
      units += source.columns[index].name.length + (field.kind === 'null' || field.kind === 'default' ? 0 : field.value.length);
      if (units * owner.count > sqliteTableEditLimits.inputUnits) return text.budget;
    }
    return '';
  }
  /** 一份准确草稿只交付一次；失败保输入，明确改动后才可再次确认，禁止同步重入。 */
  function save(): void {
    if (!local() || saving.current || attempted.current.has(draft)) return; saving.current = true;
    try {
      if (!sourceCurrent()) { setError(text.stale); return; }
      if (!countValid || !source.columns.length) { setError(text.invalid); return; }
      const reason = budget(draft); if (reason) { setError(reason); return; }
      const fields: SqliteFillField[] = [];
      for (let index = 0; index < draft.fields.length; index++) {
        const field = draft.fields[index]; if (!field.include) continue; const column = source.columns[index].index;
        if (field.kind === 'default') { if (!owner.allNew) { setError(text.invalid); return; } fields.push(Object.freeze({ column, value: undefined })); continue; }
        const parsed = sqliteEditValueSchema.safeParse(field.kind === 'null' ? { kind: 'null' } : { kind: field.kind, value: field.value });
        if (!parsed.success) { setError(text.invalid); return; } fields.push(Object.freeze({ column, value: Object.freeze(parsed.data) }));
      }
      if (!sourceCurrent()) { setError(text.stale); return; }
      attempted.current.add(draft);
      if (!owner.onSave(Object.freeze(fields))) { setError(text.stale); return; }
      closed.current = true; owner.onClose();
    } catch { if (mounted.current) setError(text.invalid); }
    finally { saving.current = false; }
  }
  /** 失效仍能取消自己的窗口；误复用ticket/key后旧关闭不能清除继任输入。 */
  function close(): void { if (!local() || propsInvalid.current || saving.current) return; closed.current = true; owner.onClose(); }
  useLayoutEffect(() => { mounted.current = true; committed.current = renderTicket; return () => { if (committed.current === renderTicket) committed.current = undefined; mounted.current = false; }; });
  const valid = sourceCurrent(), chosen = draft.fields.filter(field => field.include).length, estimate = budget(draft), disabled = !valid || !countValid || !source.columns.length;
  return <Modal title={text.title} wide onClose={close}><div className="dialog-body" data-sqlite-fill-owner={owner.ownerId}>
    <p>{owner.page.target.database}.{owner.page.target.table}</p><p>{text.count(owner.count)}</p><p>{text.hint}</p><p>{owner.allNew ? text.allNewHint : text.existingHint}</p><p>{text.generatedHint}</p>
    {source.columns.map((column, index) => { const field = draft.fields[index]; return <fieldset key={column.index}><legend>{column.name}</legend>
      <label><input type="checkbox" aria-label={text.include(column.name)} checked={field.include} disabled={disabled} onChange={event => change(index, { include: event.target.checked }, field.epoch, true)}/>{text.include(column.name)}</label>
      <select aria-label={text.type(column.name)} value={field.kind} disabled={disabled || !field.include} onChange={event => change(index, { kind: event.target.value as FillKind }, field.epoch, true)}>{Object.entries(text.kinds).filter(([kind]) => kind !== 'default' || owner.allNew).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select>
      <textarea aria-label={text.value(column.name)} value={field.value} maxLength={sqliteTableEditLimits.valueUnits} disabled={disabled || !field.include || field.kind === 'null' || field.kind === 'default'} onChange={event => change(index, { value: event.target.value }, field.epoch, false)}/>
    </fieldset>; })}<p role="status">{text.selectedFields(chosen)}</p>
    <ErrorBox message={!valid ? text.stale : !source.columns.length ? text.readonly : !countValid ? text.invalid : error || (estimate === text.budget ? estimate : '')}/>
  </div><footer><button type="button" aria-label={text.cancel} onClick={close}>{text.cancel}</button><button type="button" className="primary" aria-label={text.save} disabled={disabled || !chosen || !!estimate || attempted.current.has(draft)} onClick={save}>{text.save}</button></footer></Modal>;
}
