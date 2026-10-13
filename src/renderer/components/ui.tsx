import { zh } from '../locales/zh-CN';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle } from 'lucide-react';

/** 对话框限制键盘焦点并在关闭后还原，关闭回调通过引用保持最新状态。 */
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const elements = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]');
        if (!elements?.length) return;
        if (event.shiftKey && document.activeElement === elements[0]) { event.preventDefault(); elements[elements.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === elements[elements.length - 1]) { event.preventDefault(); elements[0].focus(); }
      }
    };
    document.addEventListener('keydown', listener, true);
    return () => { document.removeEventListener('keydown', listener, true); previous?.focus(); };
  }, []);
  return <div className="modal-overlay"><div ref={root} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label={zh.dialogs.text001} onClick={onClose}><X size={18}/></button></header>{children}</div></div>;
}
export function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) { return <label className={`field ${full ? 'full' : ''}`}><span>{label}</span>{children}</label>; }
export function Empty({ title, text, children }: { title: string; text?: string; children?: ReactNode }) { return <div className="empty"><strong>{title}</strong>{text && <p>{text}</p>}{children}</div>; }
export function Spinner({ text = zh.common.loading }: { text?: string }) { return <span className="spinner"><LoaderCircle className="spin" size={15}/>{text}</span>; }
export function ErrorBox({ message }: { message?: string }) { return message ? <div className="error-box" role="alert">{message}</div> : null; }
