/* ==================== Workbench UI Primitives ==================== */
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/* ---------- Button ---------- */

type BtnVariant = 'default' | 'primary' | 'ghost' | 'danger';
type BtnSize = 'sm' | 'md' | 'lg';

export function Btn({
  variant = 'default',
  size = 'md',
  block = false,
  className = '',
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: BtnSize;
  block?: boolean;
}) {
  const v =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'ghost'
        ? 'btn-ghost'
        : variant === 'danger'
          ? 'btn-danger'
          : '';
  const s = size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : '';
  return (
    <button
      className={`btn ${v} ${s} ${block ? 'btn-block' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function IconBtn({
  danger = false,
  small = false,
  className = '',
  title,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  danger?: boolean;
  small?: boolean;
}) {
  return (
    <button
      className={`icon-btn ${danger ? 'icon-btn-danger' : ''} ${small ? 'icon-btn-sm' : ''} ${className}`}
      title={title}
      aria-label={title}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------- Segmented control ---------- */

export function Seg<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: { id: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const iconOnly = options.every((o) => !o.label);
  return (
    <div className={`seg ${iconOnly ? 'seg-icons' : ''} ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          title={o.label || undefined}
          aria-label={o.label || undefined}
          className={value === o.id ? 'active' : ''}
          onClick={() => onChange(o.id)}
          type="button"
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <IconBtn title="Close" onClick={onClose} small>
            <X />
          </IconBtn>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

/* ---------- Toasts ---------- */

export interface ToastMsg {
  id: string;
  title: string;
  desc?: string;
  leaving?: boolean;
}

let toastId = 0;
const toastListeners = new Set<(toasts: ToastMsg[]) => void>();
let toasts: ToastMsg[] = [];

function emit() {
  toastListeners.forEach((l) => l([...toasts]));
}

export function toast(title: string, desc?: string, duration = 3200) {
  const t: ToastMsg = { id: `t${++toastId}`, title, desc };
  toasts = [...toasts.slice(-3), t];
  emit();
  setTimeout(() => {
    toasts = toasts.map((x) => (x.id === t.id ? { ...x, leaving: true } : x));
    emit();
    setTimeout(() => {
      toasts = toasts.filter((x) => x.id !== t.id);
      emit();
    }, 320);
  }, duration);
}

export function ToastStack() {
  const [list, setList] = useState<ToastMsg[]>([]);
  useEffect(() => {
    toastListeners.add(setList);
    return () => {
      toastListeners.delete(setList);
    };
  }, []);
  if (typeof document === 'undefined' || !list.length) return null;
  return createPortal(
    <div className="toast-stack" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.leaving ? 'toast-out' : ''}`}>
          <div className="toast-title">{t.title}</div>
          {t.desc && <div className="toast-desc">{t.desc}</div>}
        </div>
      ))}
    </div>,
    document.body
  );
}

/* ---------- now ticker (ONE shared 1s clock for all live components) ---------- */

let tickerNow = new Date();
const tickerListeners = new Set<() => void>();
let tickerId: ReturnType<typeof setInterval> | null = null;

function ensureTicker() {
  if (tickerId !== null || typeof window === 'undefined') return;
  tickerId = setInterval(() => {
    tickerNow = new Date();
    tickerListeners.forEach((l) => l());
  }, 1000);
}

export function useNow(active = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    ensureTicker();
    const update = () => setNow(tickerNow);
    update(); // sync immediately with the shared clock
    tickerListeners.add(update);
    return () => {
      tickerListeners.delete(update);
    };
  }, [active]);
  return now;
}

/* ---------- confirm dialog replacement (uses window.confirm) ---------- */

export function useConfirm() {
  return useCallback((msg: string) => {
    if (typeof window !== 'undefined') return window.confirm(msg);
    return false;
  }, []);
}

/* ---------- media query (SSR-safe) ---------- */

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/* ---------- portal dropdown menu (click-outside + Esc) ---------- */

export function PopMenu({
  open,
  onClose,
  anchorRef,
  children,
  align = 'end',
  width = 220,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  align?: 'start' | 'end';
  width?: number;
}) {
  /* position: measured after mount so the menu can flip ABOVE its anchor
     when there isn't room below (bottom toolbars) — never off-window */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  const place = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    const menuH = ref.current?.offsetHeight ?? 0;
    if (!r) {
      setPos(null);
      return;
    }
    let left = align === 'end' ? r.right - width : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const top =
      spaceBelow < menuH + 12 && r.top > menuH + 12
        ? Math.max(8, r.top - menuH - 6) /* flip up */
        : Math.min(r.bottom + 6, Math.max(8, window.innerHeight - menuH - 8));
    setPos({ top, left });
  }, [anchorRef, align, width]);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    /* first paint renders off-screen-invisible so it can be measured, then placed */
    requestAnimationFrame(place);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
    };
  }, [open, onClose, anchorRef, align, width, place]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      className={`pop-menu${pos ? '' : ' pop-menu-measuring'}`}
      role="menu"
      style={
        pos
          ? { position: 'fixed', top: pos.top, left: pos.left, width }
          : { position: 'fixed', top: -9999, left: -9999, width, visibility: 'hidden' }
      }
    >
      {children}
    </div>,
    document.body
  );
}

export function PopMenuItem({
  icon,
  label,
  onClick,
  active,
  danger,
}: {
  icon?: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`pop-menu-item ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
