import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { useNotebook } from '../../store/notebook';
import type { Card } from '../../types';
import { CardBody } from '../CardBody';

interface Props {
  card: Card;
  x: number;
  y: number;
  measured: boolean;
  isRoot: boolean;
  childCount: number;
  selected: boolean;
  editing: boolean;
  dragging: boolean;
  dropChild: boolean;
  /** Alt-dragged cards would become this card's answers. */
  dropAnswer: boolean;
  searchState: 'match' | 'dim' | null;
  flashNonce: number;
  onPointerDown(e: React.PointerEvent, id: string): void;
  onDoubleClick(id: string): void;
  onReport(id: string, w: number, h: number): void;
}

export const CardNode = memo(function CardNode(p: Props) {
  const { card } = p;
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    p.onReport(card.id, el.offsetWidth, el.offsetHeight);
    const ro = new ResizeObserver(() => p.onReport(card.id, el.offsetWidth, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !p.flashNonce) return;
    el.classList.remove('flash');
    void el.offsetWidth; // restart the animation
    el.classList.add('flash');
    const t = setTimeout(() => el.classList.remove('flash'), 1300);
    return () => clearTimeout(t);
  }, [p.flashNonce]);

  return (
    <div
      ref={ref}
      data-card={card.id}
      className={[
        'card-node',
        p.isRoot && 'root',
        p.selected && 'selected',
        p.dragging && 'dragging',
        p.dropChild && 'drop-child',
        p.dropAnswer && 'drop-answer',
        !p.measured && 'unmeasured',
        p.searchState,
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ transform: `translate(${p.x}px, ${p.y}px)`, '--cc': `var(--c-${card.color})` } as React.CSSProperties}
      onPointerDown={(e) => p.onPointerDown(e, card.id)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        p.onDoubleClick(card.id);
      }}
    >
      <CardBody card={card} editing={p.editing} />
      {p.childCount > 0 && (
        <button
          className={`collapse-btn ${card.collapsed ? 'collapsed' : ''}`}
          title={card.collapsed ? 'Expand' : 'Collapse'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            useNotebook.getState().toggleCollapsed(card.id);
          }}
        >
          {card.collapsed ? p.childCount : '–'}
        </button>
      )}
    </div>
  );
});
