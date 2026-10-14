import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { useLibrary } from '../store/library';
import { useNotebook } from '../store/notebook';
import { useStudy } from '../store/study';
import type { Card } from '../types';
import { locateCard } from './cardActions';
import { Icon } from './Icon';
import { MathText } from './MathText';

export interface PreviewAnchor {
  /** Card position on screen, relative to the container the preview is rendered in. */
  left: number;
  top: number;
  width: number;
}

const MARGIN = 12;

/**
 * Enlarged, full-content view of a card, shown over the map where the card is.
 * It is not scaled with the canvas, so it stays readable at any zoom level.
 */
export function CardPreview({
  card,
  anchor,
  bounds,
  onClose,
}: {
  card: Card;
  anchor: PreviewAnchor;
  bounds: { w: number; h: number };
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const imageUrl = useAssetUrl(card.imageId);
  const doc = useLibrary((s) => (card.source ? s.docs.find((d) => d.id === card.source!.docId) : undefined));
  const width = Math.max(260, Math.min(600, bounds.w - MARGIN * 2, Math.max(420, anchor.width * 1.5)));
  const left = Math.min(Math.max(anchor.left, MARGIN), bounds.w - width - MARGIN);
  const [top, setTop] = useState(Math.max(anchor.top, MARGIN));

  // Once the height is known, slide up if needed so the whole card fits.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    setTop(Math.max(MARGIN, Math.min(anchor.top, bounds.h - h - MARGIN)));
  }, [anchor.top, bounds.h, card, imageUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const title = card.title.trim();
  const excerpt = card.excerpt.trim();

  return (
    <div
      ref={ref}
      className="card-preview"
      style={{ left, top, width, maxHeight: bounds.h - MARGIN * 2, '--cc': `var(--c-${card.color})` } as React.CSSProperties}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="card-preview-head">
        {card.source ? (
          <button className="btn" title="Locate in document" disabled={!doc} onClick={() => locateCard(card)}>
            <Icon name="locate" size={15} />
            <span className="ellipsis">{doc ? `${doc.title} · p.${card.source.page}` : `p.${card.source.page}`}</span>
          </button>
        ) : (
          <span className="muted" style={{ paddingLeft: 6, fontSize: 12 }}>
            Card
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="btn icon"
          title="Edit title"
          onClick={() => {
            onClose();
            useNotebook.getState().setEditing(card.id);
          }}
        >
          <Icon name="pencil" size={16} />
        </button>
        <button
          className="btn icon"
          title="Notes, tags and review (card panel)"
          onClick={() => {
            useNotebook.getState().select(card.id);
            useStudy.getState().set({ inspector: true });
          }}
        >
          <Icon name="panel" size={16} />
        </button>
        <button className="btn icon" title="Close (Esc)" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="card-preview-body">
        {title && (
          <div className="card-preview-title">
            <MathText text={title} />
          </div>
        )}
        {excerpt && (
          <div className="card-preview-excerpt">
            <MathText text={excerpt} />
          </div>
        )}
        {imageUrl && <img className="card-preview-image" src={imageUrl} alt="" draggable={false} />}
        {!title && !excerpt && !imageUrl && <div className="muted">Untitled card</div>}
        {card.comment.trim() && (
          <div className="card-preview-notes">
            <MathText text={card.comment.trim()} />
          </div>
        )}
        {card.tags.length > 0 && (
          <div className="card-foot">
            {card.tags.map((t) => (
              <span key={t} className="badge">
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
