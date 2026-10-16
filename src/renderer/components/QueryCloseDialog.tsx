import { createPortal } from 'react-dom';
import { Modal } from './ui';
import { queryCloseZh as text } from '../locales/queryClose.zh-CN';

/** 关闭入口使用独立三选；portal保证关闭后台标签时也能看到确认。 */
export function QueryCloseDialog({ title, onSave, onDiscard, onCancel }: { title: string; onSave(): void; onDiscard(): void; onCancel(): void }) {
  return createPortal(<Modal title={text.title} onClose={onCancel}><div className="modal-content"><strong>{title}</strong><p>{text.hint}</p></div><footer className="modal-footer"><button onClick={onCancel}>{text.cancel}</button><span className="grow"/><button onClick={onDiscard}>{text.discard}</button><button className="primary" onClick={onSave}>{text.save}</button></footer></Modal>, document.body);
}
