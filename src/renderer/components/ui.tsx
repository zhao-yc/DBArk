import { zh } from '../locales/zh-CN';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, LoaderCircle } from 'lucide-react';
import '../usageHelp.css';

/** 普通操作规则按需展开；原生摘要支持键盘，风险与即时状态由调用方保持可见。 */
export function UsageHelp({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <details className={`usage-help ${className}`.trim()}><summary>{zh.common.usageHelp}</summary><div className="usage-help-content">{children}</div></details>;
}

/** 对话框限制键盘焦点并在关闭后还原，关闭回调通过引用保持最新状态。 */
export function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>('input, select, textarea, button, summary')?.focus();
    /** 拦截 Escape 并循环 Tab 焦点，避免键盘操作穿透到对话框后方。 */
    const listener = (event: KeyboardEvent) => {
      // 输入法组合阶段的 Escape/Tab 属于输入法；捕获层必须先跳过，避免提前关闭弹窗或移动焦点。
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const elements = root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]');
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
/** 统一字段标签与布局，具体输入类型由调用方决定。 */
export function Field({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) { return <label className={`field ${full ? 'full' : ''}`}><span>{label}</span>{children}</label>; }
/** 空白状态展示可操作说明，不向用户填充虚构的数据结果。 */
export function Empty({ title, text, children }: { title: string; text?: string; children?: ReactNode }) { return <div className="empty"><strong>{title}</strong>{text && <p>{text}</p>}{children}</div>; }
/** 统一呈现进行中状态，同时保留可读的文字说明。 */
export function Spinner({ text = zh.common.loading }: { text?: string }) { return <span className="spinner"><LoaderCircle className="spin" size={15}/>{text}</span>; }
/** 错误以纯文本呈现并通知辅助技术，绝不把驱动返回内容解释为 HTML。 */
export function ErrorBox({ message }: { message?: string }) { return message ? <div className="error-box" role="alert">{message}</div> : null; }
