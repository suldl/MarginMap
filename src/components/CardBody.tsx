import { useLayoutEffect, useRef, useState } from 'react';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { useNotebook } from '../store/notebook';
import type { Card } from '../types';
import { addChild, addSibling, locateCard } from './cardActions';
import { Icon } from './Icon';
import { useLatexAssist } from './LatexAssist';
import { MathText } from './MathText';

/** The inside of a card (title, excerpt, image, notes, badges), shared by the mind map and whiteboard. */
export function CardBody({ card, editing, structural = true }: { card: Card; editing: boolean; structural?: boolean }) {
  const imageUrl = useAssetUrl(card.imageId);
  const title = card.title.trim();
  const excerpt = card.excerpt.trim();
  const empty = !title && !excerpt && !card.imageId;
  return (
    <>
      {editing ? (
        <TitleEditor card={card} structural={structural} />
      ) : title ? (
        <div className="card-title">
          <MathText text={title} />
        </div>
      ) : empty ? (
        <div className="card-title placeholder">Untitled</div>
      ) : null}
      {excerpt && (
        <div className="card-excerpt">
          <MathText text={excerpt} />
        </div>
      )}
      {imageUrl && <img className="card-image" src={imageUrl} alt="" draggable={false} />}
      {card.comment.trim() && (
        <div className="card-comment">
          <MathText text={card.comment.trim()} />
        </div>
      )}
      {(card.source || card.review || card.tags.length > 0) && (
        <div className="card-foot">
          <SourceBadge card={card} />
          {card.review && (
            <span className="badge" title="In review">
              <Icon name="cards" size={11} />
            </span>
          )}
          {card.tags.map((t) => (
            <span key={t} className="badge">
              #{t}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** The page tag of an excerpt card; clicking it shows the excerpt in the document (clicking the card itself only selects it). */
export function SourceBadge({ card }: { card: Card }) {
  if (!card.source) return null;
  return (
    <button
      className="badge source-badge"
      title="Show in document"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        locateCard(card);
      }}
    >
      p.{card.source.page}
    </button>
  );
}

/**
 * Inline title editor. In the mind map (`structural`), Tab commits and adds a
 * child card; elsewhere Tab and Enter simply commit. Typing `\` offers LaTeX commands.
 */
export function TitleEditor({ card, structural = true }: { card: Card; structural?: boolean }) {
  const [value, setValue] = useState(card.title);
  const assist = useLatexAssist<HTMLTextAreaElement>(value, setValue);
  const ref = assist.ref;
  const done = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);

  const commit = (next: 'stay' | 'child' | 'sibling' | 'cancel') => {
    if (done.current) return;
    done.current = true;
    const nb = useNotebook.getState();
    const cur = nb.nb?.cards[card.id];
    if (!cur) return;
    const isBlank = !value.trim() && !cur.excerpt.trim() && !cur.imageId && !cur.comment.trim();
    if (next === 'cancel') {
      // Escaping out of a brand-new, empty card discards it.
      if (!cur.title && isBlank && Date.now() - cur.createdAt < 60_000) nb.deleteCards([card.id]);
      else nb.setEditing(null);
      return;
    }
    if (value.trim() !== cur.title) nb.updateCard(card.id, { title: value.trim() });
    nb.setEditing(null);
    if (structural && next === 'child') addChild(card.id);
    if (structural && next === 'sibling') addSibling(card.id);
  };

  return (
    <>
      <textarea
        ref={ref}
        className="card-edit"
        rows={1}
        value={value}
        placeholder="Title"
        onChange={(e) => setValue(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (assist.onKeyDown(e)) return;
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit('stay');
          } else if (e.key === 'Tab') {
            e.preventDefault();
            commit('child');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            commit('cancel');
          }
        }}
        onBlur={() => commit('stay')}
      />
      {assist.popup}
    </>
  );
}
