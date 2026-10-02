import { useEffect, useRef, useState } from 'react';

const MENU_WIDTH = 190;

// A button that opens a small menu of choices. The menu is position: fixed so
// it isn't clipped by the scrolling controls bar it lives in.
export default function DropdownButton({ label, items, disabled, className = 'action-btn btn-secondary' }) {
  const [pos, setPos] = useState(null); // null = closed
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const close = () => setPos(null);

  const toggle = (e) => {
    e.stopPropagation();
    if (pos) return close();
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
    setPos({ top: r.bottom + 6, left });
  };

  useEffect(() => {
    if (!pos) return;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={className}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        onClick={toggle}
      >
        {label} <span className="dropdown-caret" aria-hidden="true">▾</span>
      </button>
      {pos && (
        <div ref={menuRef} className="dropdown-menu" role="menu" style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}>
          {items.map((item) => (
            <div
              key={item.label}
              role="menuitem"
              tabIndex={0}
              className="context-menu-item"
              onClick={() => { close(); item.onClick(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); item.onClick(); } }}
            >
              <span aria-hidden="true">{item.icon}</span> {item.label}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
