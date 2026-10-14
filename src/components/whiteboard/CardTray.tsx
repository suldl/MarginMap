import { useMemo, useState } from 'react';
import { buildTree, cardLabel, flatten, matchesQuery } from '../../lib/tree';
import { boardOf, useNotebook } from '../../store/notebook';
import { Icon } from '../Icon';

export const CARD_DRAG_MIME = 'application/x-marginmap-card';

/** Side panel listing the notebook's cards; drag (or click +) to put them on the whiteboard. */
export function CardTray({
  onClose,
  onPlace,
  onFocus,
}: {
  onClose(): void;
  onPlace(cardIds: string[]): void;
  onFocus(cardId: string): void;
}) {
  const cards = useNotebook((s) => s.nb!.cards);
  const items = useNotebook((s) => boardOf(s.nb).items);
  const [q, setQ] = useState('');
  const placed = useMemo(() => new Set(items.flatMap((it) => (it.type === 'card' ? [it.cardId] : []))), [items]);
  const rows = flatten(buildTree(cards)).filter((r) => !q.trim() || matchesQuery(r.card, q.trim()));
  const unplaced = rows.filter((r) => !placed.has(r.card.id)).map((r) => r.card.id);

  return (
    <aside
      className="wb-tray"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="wb-tray-head">
        <strong>Cards</strong>
        <span className="muted" style={{ fontSize: 12 }}>
          {unplaced.length} not on board
        </span>
        <div style={{ flex: 1 }} />
        <button className="btn icon" title="Close" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div style={{ padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input className="input" placeholder="Filter cards…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn outline" disabled={!unplaced.length} onClick={() => onPlace(unplaced)}>
          <Icon name="plus" size={15} /> Add {unplaced.length ? `all ${unplaced.length}` : 'all'} to board
        </button>
      </div>
      <div className="wb-tray-list">
        {!rows.length && <div className="muted" style={{ padding: 12, fontSize: 12.5 }}>No cards{q ? ' match' : ' yet'}.</div>}
        {rows.map(({ card, depth }) => {
          const isPlaced = placed.has(card.id);
          return (
            <div
              key={card.id}
              className={`wb-tray-row ${isPlaced ? 'placed' : ''}`}
              style={{ paddingLeft: 8 + Math.min(depth, 6) * 12, '--cc': `var(--c-${card.color})` } as React.CSSProperties}
              draggable={!isPlaced}
              onDragStart={(e) => {
                e.dataTransfer.setData(CARD_DRAG_MIME, card.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => (isPlaced ? onFocus(card.id) : onPlace([card.id]))}
              title={isPlaced ? 'On the board — click to show it' : 'Drag onto the board, or click to add'}
            >
              <span className="ol-dot" style={{ marginTop: 0 }} />
              <span className="wb-tray-label">{card.imageId && !card.title && !card.excerpt ? 'Image excerpt' : cardLabel(card, 70)}</span>
              <Icon name={isPlaced ? 'check' : 'plus'} size={14} className="muted" />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
