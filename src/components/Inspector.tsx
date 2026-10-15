import { useLayoutEffect, useMemo, useState } from 'react';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { buildTree, cardLabel } from '../lib/tree';
import { formatDate, relativeDue } from '../lib/util';
import { useLibrary } from '../store/library';
import { groupsOf, useNotebook } from '../store/notebook';
import { useStudy } from '../store/study';
import { COLORS, type Card } from '../types';
import { deleteWithUndoHint, groupSelection, locateCard } from './cardActions';
import { Icon } from './Icon';
import { MathPreview, useLatexAssist } from './LatexAssist';
import { useUi } from '../store/ui';

/** Auto-growing textarea with LaTeX autocomplete and a formula preview. */
export function MathTextarea({
  value,
  onChange,
  placeholder,
  minRows = 2,
  autoFocus,
}: {
  value: string;
  onChange(next: string): void;
  placeholder?: string;
  minRows?: number;
  autoFocus?: boolean;
}) {
  const assist = useLatexAssist<HTMLTextAreaElement>(value, onChange);
  const ref = assist.ref;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(el.scrollHeight + 2, minRows * 21 + 18)}px`;
  }, [value, minRows, ref]);
  return (
    <>
      <textarea
        ref={ref}
        className="textarea"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ resize: 'none', overflow: 'hidden' }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => assist.onKeyDown(e)}
      />
      {assist.popup}
      <MathPreview text={value} />
    </>
  );
}

function MathInput({ value, onChange, placeholder }: { value: string; onChange(next: string): void; placeholder?: string }) {
  const assist = useLatexAssist<HTMLInputElement>(value, onChange);
  return (
    <>
      <input
        ref={assist.ref}
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => assist.onKeyDown(e)}
      />
      {assist.popup}
      <MathPreview text={value} />
    </>
  );
}

export function Inspector() {
  const card = useNotebook((s) => (s.selectedId ? s.nb?.cards[s.selectedId] : undefined));
  const multi = useNotebook((s) => s.selectedIds.length > 1);
  const childCount = useNotebook((s) => (s.selectedId && s.nb ? (buildTree(s.nb.cards).children.get(s.selectedId) ?? []).length : 0));
  const set = useStudy((s) => s.set);

  return (
    <aside className="inspector">
      <div className="toolbar">
        <strong style={{ paddingLeft: 6 }}>{multi ? 'Selection' : 'Card'}</strong>
        <div className="grow" />
        <button className="btn icon" title="Hide panel" onClick={() => set({ inspector: false })}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {multi ? (
        <SelectionDetails />
      ) : card ? (
        <CardDetails key={card.id} card={card} childCount={childCount} />
      ) : (
        <div className="empty" style={{ flex: 1 }}>
          <div>
            <Icon name="cards" size={36} />
            <h3>No card selected</h3>
            <p>
              Select a card in the mind map to edit its title, notes, tags and review settings.
              <br />
              Drag across empty space or Ctrl+click to select several.
            </p>
          </div>
        </div>
      )}
    </aside>
  );
}

function GroupField({ cardIds }: { cardIds: string[] }) {
  const groups = useNotebook((s) => groupsOf(s.nb));
  const cards = useNotebook((s) => s.nb!.cards);
  const ids = cardIds.filter((id) => cards[id]);
  const current = new Set(ids.map((id) => cards[id].groupId ?? ''));
  const value = current.size === 1 ? [...current][0] : '__mixed';
  const group = groups.find((g) => g.id === value);
  return (
    <div className="field">
      <label>
        <Icon name="group" size={13} /> Group
      </label>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {group && <span className="swatch" style={{ '--sw': `var(--c-${group.color})`, cursor: 'default' } as React.CSSProperties} />}
        <select
          className="input"
          style={{ flex: 1 }}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            const nb = useNotebook.getState();
            if (v === '__new') void groupSelection(ids);
            else if (v !== '__mixed') nb.updateCards(Object.fromEntries(ids.map((id) => [id, { groupId: v || undefined }])));
          }}
        >
          {value === '__mixed' && <option value="__mixed">Several groups</option>}
          <option value="">No group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          <option value="__new">New group…</option>
        </select>
      </div>
    </div>
  );
}

function CardDetails({ card, childCount }: { card: Card; childCount: number }) {
  const update = (patch: Partial<Card>, key?: string) => useNotebook.getState().updateCard(card.id, patch, key);
  const imageUrl = useAssetUrl(card.imageId);
  const doc = useLibrary((s) => (card.source ? s.docs.find((d) => d.id === card.source!.docId) : undefined));
  const [tagDraft, setTagDraft] = useState('');
  const answerCount = card.answers?.length ?? 0;

  const addTag = () => {
    const t = tagDraft.trim().replace(/^#/, '');
    if (t && !card.tags.includes(t)) update({ tags: [...card.tags, t] });
    setTagDraft('');
  };

  return (
    <>
      <div className="inspector-body">
        <div className="field">
          <label>Title</label>
          <MathInput value={card.title} placeholder="Add a title… ($x^2$ for formulas)" onChange={(v) => update({ title: v }, 'title')} />
        </div>

        <div className="field">
          <div className="label">Color</div>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${card.color === c ? 'on' : ''}`}
                style={{ '--sw': `var(--c-${c})` } as React.CSSProperties}
                title={c}
                onClick={() => update({ color: c })}
              />
            ))}
          </div>
        </div>

        {card.source && (
          <div className="field">
            <div className="label">Source</div>
            <div className="source-box">
              <Icon name="file" size={16} />
              <span className="grow" title={doc?.title}>
                {doc ? doc.title : 'Removed document'} · p.{card.source.page}
              </span>
              <button className="btn icon" title="Locate in document" disabled={!doc} onClick={() => locateCard(card)}>
                <Icon name="locate" size={16} />
              </button>
            </div>
          </div>
        )}

        {imageUrl && (
          <div className="field">
            <div className="label">Area excerpt</div>
            <img className="inspector-image" src={imageUrl} alt="" />
            {card.imageText && (
              <div className="muted" style={{ fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>
                {card.imageText}
              </div>
            )}
          </div>
        )}

        {(!card.imageId || card.excerpt) && (
          <div className="field">
            <label>Excerpt</label>
            <MathTextarea value={card.excerpt} placeholder="Excerpted text" onChange={(v) => update({ excerpt: v }, 'excerpt')} />
          </div>
        )}

        <div className="field">
          <label>
            <Icon name="comment" size={13} /> Notes
          </label>
          <MathTextarea
            value={card.comment}
            minRows={3}
            placeholder="Your thoughts, explanations, questions… LaTeX: $E=mc^2$, $$\int_0^1 x\,dx$$"
            onChange={(v) => update({ comment: v }, 'comment')}
          />
        </div>

        <div className="field">
          <label>
            <Icon name="answer" size={13} /> Answers
          </label>
          <div className="answers-field">
            <span className="muted">{answerCount ? `${answerCount} answer card${answerCount === 1 ? '' : 's'}` : 'None yet'}</span>
            <div style={{ flex: 1 }} />
            {answerCount > 0 && (
              <button className="btn outline" onClick={() => useUi.getState().openAnswers(card.id)}>
                Show
              </button>
            )}
            <button className="btn outline" onClick={() => useUi.getState().openAnswers(card.id, true)}>
              <Icon name="plus" size={14} /> Add
            </button>
          </div>
        </div>

        <div className="field">
          <label>
            <Icon name="tag" size={13} /> Tags
          </label>
          <div className="tags input" style={{ height: 'auto', minHeight: 32, padding: '3px 6px' }}>
            {card.tags.map((t) => (
              <span key={t} className="tag-chip">
                #{t}
                <button onClick={() => update({ tags: card.tags.filter((x) => x !== t) })} title="Remove tag">
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              placeholder={card.tags.length ? '' : 'Add tag…'}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                } else if (e.key === 'Backspace' && !tagDraft && card.tags.length) {
                  update({ tags: card.tags.slice(0, -1) });
                }
              }}
              onBlur={addTag}
            />
          </div>
        </div>

        <GroupField cardIds={[card.id]} />

        <div className="field">
          <div className="toggle-row">
            <div>
              <div style={{ fontWeight: 600 }}>Review as flashcard</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {card.review
                  ? `Next review ${relativeDue(card.review.due)} · ${card.review.reps} review${card.review.reps === 1 ? '' : 's'}`
                  : 'Front: title · Back: excerpt, notes, answers and child cards'}
              </div>
            </div>
            <button
              className={`switch ${card.review ? 'on' : ''}`}
              role="switch"
              aria-checked={!!card.review}
              onClick={() => useNotebook.getState().toggleReview([card.id])}
            />
          </div>
        </div>

        {childCount > 0 && (
          <div className="muted" style={{ fontSize: 12 }}>
            {childCount} child card{childCount === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <div className="inspector-foot">
        <span>Created {formatDate(card.createdAt)}</span>
        <button className="btn danger" onClick={() => deleteWithUndoHint([card.id])}>
          <Icon name="trash" size={15} /> Delete
        </button>
      </div>
    </>
  );
}

/** Bulk editing for several selected cards: colour, group, tags, review, delete. */
function SelectionDetails() {
  const ids = useNotebook((s) => s.selectedIds);
  const cards = useNotebook((s) => s.nb!.cards);
  const sel = useMemo(() => ids.map((id) => cards[id]).filter(Boolean), [ids, cards]);
  const [tagDraft, setTagDraft] = useState('');
  const store = useNotebook.getState();
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of sel) for (const t of c.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [sel]);
  const allReview = sel.every((c) => c.review);
  const color = new Set(sel.map((c) => c.color)).size === 1 ? sel[0]?.color : null;

  const addTag = () => {
    if (tagDraft.trim()) store.addTag(ids, tagDraft);
    setTagDraft('');
  };

  return (
    <>
      <div className="inspector-body">
        <div className="sel-summary">
          <strong>{sel.length} cards selected</strong>
          <button className="btn" onClick={() => store.select(null)}>
            Clear
          </button>
        </div>

        <div className="field">
          <div className="label">Color</div>
          <div className="swatches">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${color === c ? 'on' : ''}`}
                style={{ '--sw': `var(--c-${c})` } as React.CSSProperties}
                title={`Make all ${c}`}
                onClick={() => store.updateCards(Object.fromEntries(ids.map((id) => [id, { color: c }])))}
              />
            ))}
          </div>
        </div>

        <GroupField cardIds={ids} />

        <div className="field">
          <label>
            <Icon name="tag" size={13} /> Tags
          </label>
          <div className="tags input" style={{ height: 'auto', minHeight: 32, padding: '3px 6px' }}>
            {tagCounts.map(([t, n]) => (
              <span key={t} className="tag-chip" title={`${n} of ${sel.length} cards`}>
                #{t}
                {n < sel.length && <span className="muted">&nbsp;{n}</span>}
                <button onClick={() => store.removeTag(ids, t)} title="Remove from all selected cards">
                  <Icon name="x" size={11} />
                </button>
              </span>
            ))}
            <input
              value={tagDraft}
              placeholder="Tag all selected…"
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag();
                }
              }}
              onBlur={addTag}
            />
          </div>
        </div>

        <div className="field">
          <div className="toggle-row">
            <div>
              <div style={{ fontWeight: 600 }}>Review as flashcards</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {sel.filter((c) => c.review).length} of {sel.length} in review
              </div>
            </div>
            <button
              className={`switch ${allReview ? 'on' : ''}`}
              role="switch"
              aria-checked={allReview}
              onClick={() => store.toggleReview(ids, !allReview)}
            />
          </div>
        </div>

        <div className="field">
          <div className="label">Cards</div>
          <div className="sel-list">
            {sel.map((c) => (
              <button
                key={c.id}
                className="sel-row"
                style={{ '--cc': `var(--c-${c.color})` } as React.CSSProperties}
                onClick={() => {
                  store.select(c.id);
                  useStudy.getState().revealCard(c.id);
                }}
                title="Select only this card"
              >
                <span className="ol-dot" style={{ marginTop: 0 }} />
                <span className="ellipsis">{cardLabel(c, 60)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="inspector-foot">
        <button className="btn" onClick={() => void groupSelection(ids)} title="Group (Ctrl+G)">
          <Icon name="group" size={15} /> Group
        </button>
        <button
          className="btn danger"
          onClick={async () => {
            const ok = await useUi.getState().confirm({
              title: `Delete ${sel.length} cards?`,
              message: 'Their child cards are deleted too. You can undo with Ctrl+Z.',
              confirmLabel: 'Delete',
              danger: true,
            });
            if (ok) deleteWithUndoHint(ids);
          }}
        >
          <Icon name="trash" size={15} /> Delete
        </button>
      </div>
    </>
  );
}
