import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({ title, subtitle, onClose, children, tabs }: { title: string; subtitle?: string; onClose(): void; children: ReactNode; tabs?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="modal-title">{title}</h2>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {tabs}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
