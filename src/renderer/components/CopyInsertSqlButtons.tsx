import { copyInsertSqlZh as text } from '../../shared/copyInsertSql.zh-CN';

/** 两个显式入口分别对应当前行及勾选行；原始快照策略一直可见于按钮提示。 */
export function CopyInsertSqlButtons({ disabled, current, selected, onCopy }: { disabled: boolean; current: boolean; selected: boolean; onCopy(selected: boolean): void }) {
  return <><button title={text.policy} disabled={disabled || !current} onClick={() => onCopy(false)}>{text.current}</button><button title={text.policy} disabled={disabled || !selected} onClick={() => onCopy(true)}>{text.selected}</button></>;
}
