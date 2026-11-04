import { useEffect, useRef } from 'react';

/** Native modal supplies focus trapping, Escape handling and background inertness. */
export default function Dialog({ title, children, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} className="nvg-dialog" aria-labelledby="dialog-title"
    onCancel={onClose} onClick={event => { if (event.target === ref.current) onClose(); }}>
    <header><h2 id="dialog-title">{title}</h2><button type="button" className="secondary" aria-label="Close dialog" onClick={onClose}>×</button></header>
    {children}
  </dialog>;
}
