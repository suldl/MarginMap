import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { useLibrary } from '../store/library';
import { useNotebook } from '../store/notebook';
import { useStudy } from '../store/study';
import type { Card } from '../types';
import { locateCard } from './cardActions';
import { Icon } from './Icon';
import { MathText } from './MathText';

/** Only picture (area) excerpts open enlarged; text cards are already readable on the map. */
export const canEnlarge = (card: Card) => !!card.imageId;

/**
 * Enlarged, full-content view of a card: it fills nearly the whole window (below the title bar),
 * with the picture as large as it fits. Esc, the close button or a click around it closes it.
 */
export function CardPreview({ card, onClose }: { card: Card; onClose(): void }) {
  const imageUrl = useAssetUrl(card.imageId);
  const doc = useLibrary((s) => (card.source ? s.docs.find((d) => d.id === card.source!.docId) : undefined));

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

  // Rendered on the page body so it can cover the whole window; React events still reach the map,
  // so they are stopped here.
  return createPortal(
    <div
      className="card-preview-backdrop"
      onPointerDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <div className="card-preview" role="dialog" aria-label="Enlarged card" style={{ '--cc': `var(--c-${card.color})` } as React.CSSProperties}>
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
          {imageUrl && (
            <div className="card-preview-figure">
              <img className="card-preview-image" src={imageUrl} alt="" draggable={false} />
            </div>
          )}
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
    </div>,
    document.body,
  );
}
