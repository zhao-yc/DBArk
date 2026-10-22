import type { TableEncodingPair } from '../../shared/tableDefaultEncoding';
import { sameTableEncodingPair } from '../../shared/tableDefaultEncoding';
import type { TableColumnView } from '../../shared/tableColumnPatches';
import { columnEncodingZh as text } from '../locales/columnEncoding.zh-CN';
import { Field } from './ui';

/** 只编辑实际配对；切字符集先清空配对，用户必须显式选择排序规则，不猜默认。 */
export function ColumnEncodingEditor({ column, charset, value, candidates, disabled, reason, onCharset, onPair, onRestore }: { column: TableColumnView; charset: string; value?: TableEncodingPair; candidates: readonly TableEncodingPair[]; disabled: boolean; reason?: string; onCharset(value: string): void; onPair(value: string): void; onRestore(): void }) {
  const current = column.encoding?.current, charsets = [...new Set(candidates.map(pair => pair.charset))], pairs = candidates.filter(pair => pair.charset === charset);
  return <section aria-label={text.title}><h3>{text.title}</h3>
    <p aria-label={text.current}>{text.current}：{current ? current.charset + ' / ' + current.collation : text.unknown}</p><p>{text.scope}</p><p className="warning-text">{text.copy}</p><p>{text.session}</p>
    <Field label={text.charset}><select aria-label={text.charset} disabled={disabled} value={charset} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) onCharset(event.target.value); }}><option value="" disabled>{text.chooseCharset}</option>{charsets.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
    <Field label={text.collation}><select aria-label={text.collation} disabled={disabled || !charset} value={value?.charset === charset ? value.collation : ''} onChange={event => { if (!event.defaultPrevented && !event.nativeEvent?.defaultPrevented) onPair(event.target.value); }}><option value="" disabled>{text.chooseCollation}</option>{pairs.map(pair => <option key={pair.collation} value={pair.collation}>{pair.collation}</option>)}</select></Field>
    <button type="button" disabled={disabled || !current || !!value && sameTableEncodingPair(current, value)} onClick={onRestore}>{text.restore}</button><p className="muted small">{text.sameCharset}</p>{reason && <p className="warning-text">{reason}</p>}
  </section>;
}
