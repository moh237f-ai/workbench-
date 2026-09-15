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
  return (
    <div className={`seg ${className}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
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
        <div className="flex items-start justify-between gap-3">
          <h2>{title}</h2>
          <IconBtn title="Close" onClick={onClose} small>
            <X />
          </IconBtn>
        </div>
        {children}
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
