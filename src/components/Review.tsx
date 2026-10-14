import { useEffect, useMemo, useRef, useState } from 'react';
import { backend } from '../backend';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { describeNext, schedule, type Grade } from '../lib/srs';
import { buildTree, cardLabel } from '../lib/tree';
import { debounce } from '../lib/util';
import { notebookMeta, useLibrary } from '../store/library';
import { waitForSaves } from '../store/notebook';
import { useUi } from '../store/ui';
import type { Card, Notebook } from '../types';
import { Icon } from './Icon';
import { MathText } from './MathText';
import { TitleBar } from './TitleBar';

interface QueueItem {
  nbId: string;
  cardId: string;
}

const GRADES: { grade: Grade; label: string; cls: string; key: string }[] = [
  { grade: 1, label: 'Again', cls: 'again', key: '1' },
  { grade: 2, label: 'Hard', cls: 'hard', key: '2' },
  { grade: 3, label: 'Good', cls: 'good', key: '3' },
  { grade: 4, label: 'Easy', cls: 'easy', key: '4' },
];

export function Review({ notebookId }: { notebookId: string | null }) {
  const navigate = useUi((s) => s.navigate);
  const metas = useLibrary((s) => s.notebooks);
  const docs = useLibrary((s) => s.docs);
  const [books, setBooks] = useState<Map<string, Notebook> | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [done, setDone] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const total = useRef(0);

  const savers = useMemo(() => new Map<string, ReturnType<typeof debounce<[Notebook]>>>(), []);
  const persist = (nb: Notebook) => {
    let s = savers.get(nb.id);
    if (!s) {
      s = debounce((n: Notebook) => {
        void backend.saveNotebook(n).then(() => {
          const lib = useLibrary.getState();
          lib.upsertNotebookMeta(notebookMeta(n, lib.notebooks.find((m) => m.id === n.id)));
        });
      }, 300);
      savers.set(nb.id, s);
    }
    s(nb);
  };
  useEffect(() => () => savers.forEach((s) => s.flush()), [savers]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await waitForSaves();
      const ids = notebookId ? [notebookId] : metas.filter((m) => m.reviewDues.length).map((m) => m.id);
      const map = new Map<string, Notebook>();
      const items: QueueItem[] = [];
      const now = Date.now();
      for (const id of ids) {
        const nb = await backend.loadNotebook(id);
        if (!nb) continue;
        map.set(id, nb);
        for (const c of Object.values(nb.cards)) if (c.review && c.review.due <= now) items.push({ nbId: id, cardId: c.id });
      }
      // Overdue first, then new cards, shuffled lightly within each group.
      items.sort((a, b) => map.get(a.nbId)!.cards[a.cardId].review!.due - map.get(b.nbId)!.cards[b.cardId].review!.due);
      if (!alive) return;
      total.current = items.length;
      setBooks(map);
      setQueue(items);
    })();
    return () => {
      alive = false;
    };
    // Load once per session; meta changes from our own saves must not reload the queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  const current = queue[0];
  const nb = current && books?.get(current.nbId);
  const card = nb?.cards[current.cardId];

  const grade = (g: Grade) => {
    if (!nb || !card?.review || !books) return;
    const review = schedule(card.review, g);
    const next: Notebook = { ...nb, cards: { ...nb.cards, [card.id]: { ...card, review } }, updatedAt: Date.now() };
    const map = new Map(books);
    map.set(nb.id, next);
    setBooks(map);
    persist(next);
    setRevealed(false);
    if (g === 1) {
      // Show it again later in this session.
      setQueue((q) => [...q.slice(1, 6), q[0], ...q.slice(6)]);
    } else {
      setQueue((q) => q.slice(1));
      setDone((d) => d + 1);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return;
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed) {
        const g = GRADES.find((x) => x.key === e.key);
        if (g) grade(g.grade);
        else if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          grade(3);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const back = () => navigate(notebookId ? { name: 'study', notebookId } : { name: 'library' });
  const title = notebookId ? (metas.find((m) => m.id === notebookId)?.title ?? 'Notebook') : 'All notebooks';
  const progress = total.current ? done / total.current : 0;

  return (
    <>
      <TitleBar>
        <button className="btn" onClick={back}>
          <Icon name="back" /> Back
        </button>
        <div className="divider-v" />
        <strong style={{ padding: '0 6px' }}>Review · {title}</strong>
        <div className="drag" />
      </TitleBar>
      <div className="review">
        {!books ? (
          <div className="loading">
            <div className="spinner" />
          </div>
        ) : !card || !nb ? (
          <div className="empty" style={{ flex: 1 }}>
            <div>
              <Icon name="check" size={44} />
              <h3>{done ? 'Session complete' : 'Nothing due right now'}</h3>
              <p>
                {done
                  ? `You reviewed ${done} card${done === 1 ? '' : 's'}. Come back later for the next round.`
                  : 'Add cards to review from the card panel or the right-click menu in a notebook.'}
              </p>
              <button className="btn outline" style={{ marginTop: 10 }} onClick={back}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="review-progress">
              <span>
                {done} / {total.current}
              </span>
              <div className="progress-bar">
                <div style={{ width: `${progress * 100}%` }} />
              </div>
              <span>{queue.length} left</span>
            </div>
            <Flashcard
              card={card}
              nb={nb}
              revealed={revealed}
              docTitle={card.source ? docs.find((d) => d.id === card.source!.docId)?.title : undefined}
            />
            {revealed ? (
              <div className="grade-row">
                {GRADES.map((g) => (
                  <button key={g.grade} className={`btn ${g.cls}`} onClick={() => grade(g.grade)}>
                    {g.label}
                    <small>
                      {describeNext(card.review!, g.grade)} · {g.key}
                    </small>
                  </button>
                ))}
              </div>
            ) : (
              <button className="btn primary show-answer" onClick={() => setRevealed(true)}>
                Show answer <span className="kbd" style={{ color: 'inherit', borderColor: 'currentColor' }}>Space</span>
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Flashcard({ card, nb, revealed, docTitle }: { card: Card; nb: Notebook; revealed: boolean; docTitle?: string }) {
  const imageUrl = useAssetUrl(card.imageId);
  const children = buildTree(nb.cards).children.get(card.id) ?? [];
  const parent = card.parentId ? nb.cards[card.parentId] : null;
  const title = card.title.trim();
  // Without a title the excerpt (or image) becomes the prompt, and notes/children are the answer.
  const frontIsExcerpt = !title;

  return (
    <div className="flashcard" style={{ '--cc': `var(--c-${card.color})` } as React.CSSProperties}>
      <div className="context">
        <Icon name="notebook" size={13} /> {nb.title}
        {parent && <> · {cardLabel(parent, 48)}</>}
        {docTitle && card.source && (
          <>
            {' '}
            · {docTitle}, p.{card.source.page}
          </>
        )}
      </div>
      {frontIsExcerpt ? (
        <>
          {card.excerpt.trim() && (
            <div className="front excerpt">
              <MathText text={card.excerpt.trim()} />
            </div>
          )}
          {imageUrl && <img src={imageUrl} alt="" style={{ maxWidth: '100%', borderRadius: 6, alignSelf: 'flex-start', background: 'white' }} />}
          {!card.excerpt.trim() && !imageUrl && <div className="front">Untitled card</div>}
        </>
      ) : (
        <div className="front">
          <MathText text={title} />
        </div>
      )}
      {revealed && (
        <>
          <hr />
          <div className="back">
            {!frontIsExcerpt && card.excerpt.trim() && (
              <blockquote>
                <MathText text={card.excerpt.trim()} />
              </blockquote>
            )}
            {!frontIsExcerpt && imageUrl && <img src={imageUrl} alt="" />}
            {card.comment.trim() && (
              <div style={{ whiteSpace: 'pre-wrap' }}>
                <MathText text={card.comment.trim()} />
              </div>
            )}
            {children.length > 0 && (
              <ul className="children">
                {children.map((c) => (
                  <li key={c.id}>
                    <MathText text={c.title || c.excerpt || (c.imageId ? 'Image excerpt' : 'Untitled')} />
                  </li>
                ))}
              </ul>
            )}
            {!card.comment.trim() && !children.length && (frontIsExcerpt || (!card.excerpt.trim() && !imageUrl)) && (
              <div className="muted">No notes on this card yet — add some in the card panel to make a better answer.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
