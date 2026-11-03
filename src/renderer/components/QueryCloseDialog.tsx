import { createPortal } from 'react-dom';
import { Modal } from './ui';
import { queryCloseZh as text } from '../locales/queryClose.zh-CN';

/** 关闭后台标签时仍显示确认，并把内存保留和放弃明确分开。 */
export function QueryCloseDialog({ title, onSave, onDiscard, onCancel, onKeep }: { title: string; onSave(): void; onDiscard(): void; onCancel(): void; onKeep(): void }) {
  return createPortal(<Modal title={text.title} onClose={onCancel}><div className="modal-content"><strong>{title}</strong><p>{text.hint}</p><button type="button" onClick={onKeep}>{text.keepDraft}</button><p className="muted small">{text.keepHint}</p></div><footer className="modal-footer"><button onClick={onCancel}>{text.cancel}</button><span className="grow"/><button onClick={onDiscard}>{text.discard}</button><button className="primary" onClick={onSave}>{text.save}</button></footer></Modal>, document.body);
}
