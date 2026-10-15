import { useEffect, useRef, useState } from 'react';
import { buildTree, childrenOf, flatten } from '../lib/tree';
import { groupsOf, useNotebook } from '../store/notebook';
import { useStudy } from '../store/study';
import type { Card } from '../types';
import { AnswerBadge } from './Answers';
import { SourceBadge } from './CardBody';
import { addChild, addSibling, deleteWithUndoHint, groupSelection, locateCard, openCardMenu } from './cardActions';
import { Icon } from './Icon';
import { useLatexAssist } from './LatexAssist';
import { MathText } from './MathText';

type Zone = 'before' | 'after' | 'child';

export function Outline() {
  const cards = useNotebook((s) => s.nb!.cards);
  const selectedId = useNotebook((s) => s.selectedId);
  const selectedIds = useNotebook((s) => s.selectedIds);
  const groups = useNotebook((s) => groupsOf(s.nb));
  const editingId = useNotebook((s) => (s.editingIn === 'map' ? s.editingId : null));
  const reveal = useStudy((s) => s.reveal);
  const tree = buildTree(cards);
  const rows = flatten(tree, true);
  const ref = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);
  const dragId = useRef<string | null>(null);

  useEffect(() => {
    if (!reveal) return;
    useNotebook.getState().expandTo(reveal.cardId);
    requestAnimationFrame(() =>
      ref.current?.querySelector(`[data-row="${reveal.cardId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
    );
  }, [reveal]);

  useEffect(() => {
    if (!editingId && (document.activeElement === document.body || !document.activeElement)) ref.current?.focus({ preventScroll: true });
  }, [editingId]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    const nb = useNotebook.getState();
    const sel = nb.selectedId ? cards[nb.selectedId] : null;
    const idx = sel ? rows.findIndex((r) => r.card.id === sel.id) : -1;
    const selectRow = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r) {
        nb.select(r.card.id);
        ref.current?.querySelector(`[data-row="${r.card.id}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    };
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'a') {
        e.preventDefault();
        nb.setSelection(rows.map((r) => r.card.id), nb.selectedId ?? undefined);
      } else if (k === 'g' && nb.selectedIds.length) {
        e.preventDefault();
        if (e.shiftKey) for (const g of new Set(nb.selectedIds.map((id) => cards[id]?.groupId).filter(Boolean) as string[])) nb.ungroup(g);
        else void groupSelection(nb.selectedIds);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (e.altKey && sel) moveWithinSiblings(sel, 1);
        else selectRow(idx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (e.altKey && sel) moveWithinSiblings(sel, -1);
        else selectRow(idx <= 0 ? 0 : idx - 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (!sel) break;
        if ((tree.children.get(sel.id) ?? []).length && !sel.collapsed) nb.toggleCollapsed(sel.id);
        else if (sel.parentId) nb.select(sel.parentId);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (!sel) break;
        if (sel.collapsed) nb.toggleCollapsed(sel.id);
        else if (tree.children.get(sel.id)?.[0]) nb.select(tree.children.get(sel.id)![0].id);
        break;
      case 'Tab':
        e.preventDefault();
        if (!sel) break;
        if (e.shiftKey) nb.outdent(sel.id);
        else nb.indent(sel.id);
        break;
      case 'Enter':
        e.preventDefault();
        if (sel) addSibling(sel.id);
        else addChild(null);
        break;
      case 'F2':
        if (sel) nb.setEditing(sel.id);
        break;
      case 'Delete':
      case 'Backspace':
        if (nb.selectedIds.length) deleteWithUndoHint(nb.selectedIds);
        break;
      case ' ':
        if (sel?.source) {
          e.preventDefault();
          locateCard(sel);
        }
        break;
      case 'Escape':
        nb.select(null);
        break;
    }
  };

  const moveWithinSiblings = (card: Card, delta: number) => {
    const sibs = childrenOf(tree, card.parentId);
    const i = sibs.findIndex((c) => c.id === card.id);
    const target = i + delta;
    if (target < 0 || target >= sibs.length) return;
    useNotebook.getState().moveCard(card.id, card.parentId, delta > 0 ? target + 1 : target);
  };

  const onDrop = () => {
    const id = dragId.current;
    const t = drop;
    setDrop(null);
    dragId.current = null;
    if (!id || !t || id === t.id) return;
    const nb = useNotebook.getState();
    if (t.zone === 'child') {
      nb.moveCard(id, t.id, childrenOf(tree, t.id).length);
    } else {
      const target = cards[t.id];
      const sibs = childrenOf(tree, target.parentId);
      const i = sibs.findIndex((c) => c.id === t.id);
      nb.moveCard(id, target.parentId, t.zone === 'before' ? i : i + 1);
    }
  };

  if (!rows.length) {
    return (
      <div className="outline-view empty" tabIndex={0} ref={ref} onKeyDown={onKeyDown}>
        <div>
          <Icon name="outline" size={40} />
          <h3>No cards yet</h3>
          <p>
            Excerpt text from the document, or press <span className="kbd">Enter</span> to add a card.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="outline-view"
      tabIndex={0}
      ref={ref}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) useNotebook.getState().select(null);
      }}
    >
      {rows.map(({ card, depth }) => {
        const kids = (tree.children.get(card.id) ?? []).length;
        const indent = depth * 20;
        const editing = editingId === card.id;
        return (
          <div
            key={card.id}
            data-row={card.id}
            className={[
              'ol-row',
              (selectedId === card.id || selectedIds.includes(card.id)) && 'selected',
              drop?.id === card.id && `drop-${drop.zone}`,
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ paddingLeft: 6 + indent, '--cc': `var(--c-${card.color})`, '--indent': `${indent}px` } as React.CSSProperties}
            draggable={!editing}
            onDragStart={(e) => {
              dragId.current = card.id;
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', card.id);
            }}
            onDragOver={(e) => {
              const id = dragId.current;
              if (!id || id === card.id) return;
              // No dropping onto one's own descendants.
              let p = card.parentId;
              while (p) {
                if (p === id) return;
                p = cards[p]?.parentId ?? null;
              }
              e.preventDefault();
              const r = e.currentTarget.getBoundingClientRect();
              const fy = (e.clientY - r.top) / r.height;
              const zone: Zone = fy < 0.28 ? 'before' : fy > 0.72 ? 'after' : 'child';
              if (drop?.id !== card.id || drop.zone !== zone) setDrop({ id: card.id, zone });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop((d) => (d?.id === card.id ? null : d));
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDrop();
            }}
            onDragEnd={() => {
              setDrop(null);
              dragId.current = null;
            }}
            onClick={(e) => {
              const nb = useNotebook.getState();
              if (e.ctrlKey || e.metaKey) {
                nb.toggleSelected(card.id);
                return;
              }
              if (e.shiftKey && nb.selectedId) {
                // Range selection over the visible rows.
                const a = rows.findIndex((r) => r.card.id === nb.selectedId);
                const b = rows.findIndex((r) => r.card.id === card.id);
                if (a !== -1 && b !== -1) {
                  const [lo, hi] = a < b ? [a, b] : [b, a];
                  nb.setSelection(rows.slice(lo, hi + 1).map((r) => r.card.id), card.id);
                  return;
                }
              }
              nb.select(card.id);
            }}
            onDoubleClick={() => useNotebook.getState().setEditing(card.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              openCardMenu(e.clientX, e.clientY, card.id);
            }}
          >
            <button
              className="ol-caret"
              style={{ visibility: kids ? 'visible' : 'hidden' }}
              onClick={(e) => {
                e.stopPropagation();
                useNotebook.getState().toggleCollapsed(card.id);
              }}
            >
              <Icon name={card.collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
            </button>
            <span className="ol-dot" />
            <div className="ol-text">
              {editing ? (
                <OutlineEditor card={card} />
              ) : (
                <>
                  {card.title.trim() && (
                    <div className="ol-title">
                      <MathText text={card.title} />
                    </div>
                  )}
                  {card.excerpt.trim() && (
                    <div className={card.title.trim() ? 'ol-excerpt' : ''}>
                      <MathText text={card.excerpt} />
                    </div>
                  )}
                  {!card.title.trim() && !card.excerpt.trim() && (
                    <div className="muted">{card.imageId ? 'Image excerpt' : <i>Untitled</i>}</div>
                  )}
                </>
              )}
            </div>
            {card.collapsed && kids > 0 && <span className="badge">+{kids}</span>}
            {card.groupId && groups.find((g) => g.id === card.groupId) && (
              <span className="badge group-badge" style={{ '--gc': `var(--c-${groups.find((g) => g.id === card.groupId)!.color})` } as React.CSSProperties}>
                <Icon name="group" size={11} /> {groups.find((g) => g.id === card.groupId)!.name}
              </span>
            )}
            {card.review && (
              <span className="badge" title="In review">
                <Icon name="cards" size={11} />
              </span>
            )}
            <AnswerBadge card={card} />
            <SourceBadge card={card} />
          </div>
        );
      })}
    </div>
  );
}

function OutlineEditor({ card }: { card: Card }) {
  const [value, setValue] = useState(card.title);
  const assist = useLatexAssist<HTMLInputElement>(value, setValue);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const nb = useNotebook.getState();
    const cur = nb.nb?.cards[card.id];
    if (!cur) return;
    if (!save) {
      const blank = !cur.title && !cur.excerpt.trim() && !cur.imageId && !cur.comment.trim();
      if (blank && Date.now() - cur.createdAt < 60_000) nb.deleteCards([card.id]);
      else nb.setEditing(null);
      return;
    }
    if (value.trim() !== cur.title) nb.updateCard(card.id, { title: value.trim() });
    nb.setEditing(null);
  };
  return (
    <>
      <input
        ref={assist.ref}
        className="ol-edit"
        autoFocus
        value={value}
        placeholder="Title"
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (assist.onKeyDown(e)) return;
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
      />
      {assist.popup}
    </>
  );
}
