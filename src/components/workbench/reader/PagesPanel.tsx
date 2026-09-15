/* ==================== Reader v2 — pages panel ====================
   Right slide-over with lazy thumbnails, page filters (read / favorites /
   annotated …) and a "Review these" entry into review mode. */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { BookmarkCheck, BookCheck, PenLine, Star, X } from 'lucide-react';
import { pageToDataUrl } from '@/lib/workbench/pdf';
import type { PageAnnoMap } from '@/lib/workbench/types';
import { Btn, IconBtn } from '../ui/primitives';
import { createLimiter } from './annotations';

export type PageFilter = 'all' | 'read' | 'unread' | 'favorites' | 'annotated';

export type FilterCounts = Record<PageFilter, number>;

const FILTER_LABELS: { id: PageFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'read', label: 'Read' },
  { id: 'unread', label: 'Unread' },
  { id: 'favorites', label: 'Favorites' },
  { id: 'annotated', label: 'Annotated' },
];

export function filterLabel(f: PageFilter): string {
  return FILTER_LABELS.find((x) => x.id === f)?.label ?? 'All';
}

/* ---------- shared chip row (panel + strip context bar) ---------- */

export function PageFilterChips({
  filter,
  counts,
  onChange,
}: {
  filter: PageFilter;
  counts: FilterCounts;
  onChange: (f: PageFilter) => void;
}) {
  return (
    <div className="rd-filter-row" role="group" aria-label="Filter pages">
      {FILTER_LABELS.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`rd-filter-chip${filter === o.id ? ' on' : ''}`}
          onClick={() => onChange(o.id)}
          aria-pressed={filter === o.id}
        >
          {o.label} <span className="rd-mono">{counts[o.id]}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- thumbnail (lazy via IO, served from the shared queue) ---------- */

const thumbLimiter = createLimiter(2);

function PageThumb({
  n,
  aspect,
  url,
  request,
  isCurrent,
  isRead,
  isFav,
  isAnno,
  onOpen,
  onToggleFav,
  onToggleRead,
}: {
  n: number;
  aspect: number;
  url: string | undefined;
  request: (n: number) => void;
  isCurrent: boolean;
  isRead: boolean;
  isFav: boolean;
  isAnno: boolean;
  onOpen: () => void;
  onToggleFav: () => void;
  onToggleRead: () => void;
}) {
  const btnRef = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    if (seen) return;
    const el = btnRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((x) => x.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '320px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (seen && !url) request(n);
  }, [seen, url, n, request]);

  return (
    <div
      ref={btnRef}
      className={`rd-thumb${isCurrent ? ' current' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Go to page ${n}${isRead ? ' (read)' : ''}${isFav ? ' (favorite)' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {url ? (
        <img src={url} alt={`Page ${n} preview`} />
      ) : (
        <div className="rd-thumb-ph" style={{ aspectRatio: aspect > 0 ? String(aspect) : '0.75' }}>
          <span className="rd-spinner rd-spinner-sm" aria-label="Loading preview" />
        </div>
      )}
      <span className="rd-thumb-num rd-mono">{n}</span>
      {isRead && <span className="rd-thumb-dot" title="Read page" />}
      {isAnno && (
        <span className="rd-thumb-badge" title="Annotated">
          <PenLine size={9} />
        </span>
      )}
      {isFav && (
        <span className="rd-thumb-badge star" title="Favorite page">
          <Star size={9} />
        </span>
      )}
      <span className="rd-thumb-acts">
        <button
          type="button"
          className={`rd-thumb-act${isFav ? ' on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFav();
          }}
          title={isFav ? 'Unstar this page' : 'Star this page'}
          aria-label={isFav ? `Unstar page ${n}` : `Star page ${n}`}
        >
          <Star size={12} />
        </button>
        <button
          type="button"
          className={`rd-thumb-act${isRead ? ' on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleRead();
          }}
          title={isRead ? 'Mark unread' : 'Mark read'}
          aria-label={isRead ? `Mark page ${n} unread` : `Mark page ${n} read`}
        >
          <BookCheck size={12} />
        </button>
      </span>
    </div>
  );
}

/* ---------- panel ---------- */

export function PagesPanel({
  open,
  onClose,
  doc,
  pages,
  aspects,
  currentPage,
  readSet,
  favoriteSet,
  annos,
  annoFileSet,
  filter,
  counts,
  onFilter,
  onReviewThese,
  onGoToPage,
  onToggleFavorite,
  onToggleRead,
}: {
  open: boolean;
  onClose: () => void;
  doc: PDFDocumentProxy | null;
  pages: number[];
  aspects: number[];
  currentPage: number;
  readSet: Set<string>;
  favoriteSet: Set<string>;
  annos: PageAnnoMap;
  annoFileSet: Set<string>;
  filter: PageFilter;
  counts: FilterCounts;
  onFilter: (f: PageFilter) => void;
  onReviewThese: (f: PageFilter) => void;
  onGoToPage: (n: number) => void;
  onToggleFavorite: (n: number) => void;
  onToggleRead: (n: number) => void;
}) {
  const cacheRef = useRef<Map<number, string>>(new Map());
  const pendingRef = useRef<Set<number>>(new Set());
  const [urls, setUrls] = useState<Record<number, string>>({});

  const request = useCallback(
    (n: number) => {
      if (!doc || cacheRef.current.has(n) || pendingRef.current.has(n)) return;
      pendingRef.current.add(n);
      void thumbLimiter(() => pageToDataUrl(doc, n, 150, 0.6))
        .then((url) => {
          cacheRef.current.set(n, url);
          setUrls((prev) => ({ ...prev, [n]: url }));
        })
        .catch(() => undefined)
        .finally(() => {
          pendingRef.current.delete(n);
        });
    },
    [doc]
  );

  const emptyLabel = useMemo(() => {
    if (pages.length > 0) return null;
    switch (filter) {
      case 'read':
        return 'No read pages yet.';
      case 'unread':
        return 'Every page is marked read.';
      case 'favorites':
        return 'No starred pages yet — press F on a page to star it.';
      case 'annotated':
        return 'No annotated pages yet — draw with the pen or highlighter.';
      default:
        return 'No pages.';
    }
  }, [pages.length, filter]);

  return (
    <aside className={`rd-pages-panel${open ? ' open' : ''}`} aria-hidden={!open} aria-label="Pages panel">
      <div className="rd-pages-head">
        <span className="rd-pages-title">Pages</span>
        <span className="rd-pages-count rd-mono">{pages.length}</span>
        <IconBtn small title="Close pages panel (p)" onClick={onClose}>
          <X size={14} />
        </IconBtn>
      </div>

      <div className="rd-pages-filters">
        <PageFilterChips filter={filter} counts={counts} onChange={onFilter} />
      </div>

      {filter !== 'all' && pages.length > 0 && (
        <div className="rd-pages-review">
          <Btn size="sm" variant="primary" onClick={() => onReviewThese(filter)}>
            <BookmarkCheck size={13} /> Review these
          </Btn>
        </div>
      )}

      <div className="rd-thumb-grid">
        {pages.map((n) => {
          const key = String(n);
          return (
            <PageThumb
              key={n}
              n={n}
              aspect={aspects[n - 1] ?? 0.75}
              url={urls[n]}
              request={request}
              isCurrent={n === currentPage}
              isRead={readSet.has(key)}
              isFav={favoriteSet.has(key)}
              isAnno={(annos[key]?.length ?? 0) > 0 || annoFileSet.has(key)}
              onOpen={() => onGoToPage(n)}
              onToggleFav={() => onToggleFavorite(n)}
              onToggleRead={() => onToggleRead(n)}
            />
          );
        })}
        {emptyLabel && <div className="rd-pages-empty">{emptyLabel}</div>}
      </div>
    </aside>
  );
}
