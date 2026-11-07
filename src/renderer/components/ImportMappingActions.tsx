import type { ImportMappingAction } from '../importMapping';
import { importMappingZh as text } from '../locales/importMapping.zh-CN';

export function ImportMappingActions({ disabled, positionDisabled, onAction }: {
  disabled?: boolean; positionDisabled?: boolean; onAction(action: ImportMappingAction): void;
}) {
  return <div className="import-mapping-actions" role="group" aria-label={text.actions} title={text.replace}>
    <button type="button" disabled={disabled} onClick={() => onAction('name')}>{text.name}</button>
    <button type="button" disabled={disabled || positionDisabled} onClick={() => onAction('position')}>{text.position}</button>
    <button type="button" disabled={disabled} onClick={() => onAction('clear')}>{text.clear}</button>
  </div>;
}
