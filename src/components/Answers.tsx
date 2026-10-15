import { useEffect, useRef, useState } from 'react';
import { useAssetUrl } from '../hooks/useAssetUrl';
import { useLibrary } from '../store/library';
import { useNotebook } from '../store/notebook';
import { useUi } from '../store/ui';
import type { AnswerCard, Card } from '../types';
import { addAnswer, locateCard, locateSource, removeAnswer, updateAnswer } from './cardActions';
import { Icon } from './Icon';
import { MathTextarea } from './Inspector';
import { MathText } from './MathText';

/** The Answer button on a card (shown once the card has answers); it opens the answers window. */
export function AnswerBadge({ card }: { card: Card }) {
  const n = card.answers?.length ?? 0;
  if (!n) return null;
  return (
    <button
      className="badge answer-badge"
      title="Show the answers"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        useUi.getState().openAnswers(card.id);
      }}
    >
      <Icon name="answer" size={11} />
      {n === 1 ? 'Answer' : `${n} answers`}
    </button>
  );
}

/** Text and picture of an answer card. */
export function AnswerBody({ answer }: { answer: AnswerCard }) {
  const imageUrl = useAssetUrl(answer.imageId);
  return (
    <>
      {answer.text.trim() && (
        <div className="answer-text">
          <MathText text={answer.text.trim()} />
        </div>
      )}
      {imageUrl && <img className="answer-image" src={imageUrl} alt="" draggable={false} />}
    </>
  );
}

/** Pop-up window showing a card together with its answer cards, where answers are added, edited and deleted. */
export function AnswerWindow() {
  const req = useUi((s) => s.answers);
  const close = useUi((s) => s.closeAnswers);
  const card = useNotebook((s) => (req ? s.nb?.cards[req.cardId] : undefined));
  // The card was deleted or its notebook closed.
  useEffect(() => {
    if (req && !card) close();
  }, [req, card, close]);
  if (!req || !card) return null;
  return <AnswerDialog key={req.cardId} card={card} startNew={!!req.add} onClose={close} />;
}

const NEW = '__new';

function AnswerDialog({ card, startNew, onClose }: { card: Card; startNew: boolean; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  /** Id of the answer being edited, or NEW for one being written. */
  const [editing, setEditing] = useState<string | null>(startNew ? NEW : null);
  const [draft, setDraft] = useState('');
  const imageUrl = useAssetUrl(card.imageId);
  const doc = useLibrary((s) => (card.source ? s.docs.find((d) => d.id === card.source!.docId) : undefined));
  const answers = card.answers ?? [];
  const title = card.title.trim();
  const excerpt = card.excerpt.trim();

  // Keyboard focus moves into the window and goes back where it was afterwards.
  const returnFocus = useRef(document.activeElement);
  useEffect(() => {
    const prev = returnFocus.current;
    if (!startNew) ref.current?.focus({ preventScroll: true });
    return () => {
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const edit = (a?: AnswerCard) => {
    setEditing(a ? a.id : NEW);
    setDraft(a?.text ?? '');
  };
  const stopEditing = () => {
    setEditing(null);
    setDraft('');
    ref.current?.focus({ preventScroll: true });
  };
  const save = () => {
    const text = draft.trim();
    if (editing === NEW) {
      if (text) addAnswer(card.id, { text });
    } else {
      const a = answers.find((x) => x.id === editing);
      if (a && !text && !a.imageId) removeAnswer(card.id, a.id);
      else if (a && text !== a.text) updateAnswer(card.id, a.id, { text });
    }
    stopEditing();
  };
  const remove = (a: AnswerCard) => {
    removeAnswer(card.id, a.id);
    if (editing === a.id) stopEditing();
    useUi.getState().toast('Answer deleted · Ctrl+Z to undo');
  };

  const editor = (
    <div className="answer-edit">
      <MathTextarea value={draft} onChange={setDraft} placeholder="Type the answer… ($x^2$ for formulas)" minRows={3} autoFocus />
      <div className="answer-edit-actions">
        <span className="muted">Ctrl+Enter to save</span>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={stopEditing}>
          Cancel
        </button>
        <button className="btn primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="modal answers-window"
        role="dialog"
        aria-label="Answers"
        tabIndex={-1}
        style={{ '--cc': `var(--c-${card.color})` } as React.CSSProperties}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !e.defaultPrevented) {
            e.preventDefault();
            if (editing) stopEditing();
            else onClose();
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && editing) {
            e.preventDefault();
            save();
          }
        }}
      >
        <div className="answers-head">
          <Icon name="answer" size={18} />
          <h3>Answers</h3>
          <span className="muted">{answers.length ? answers.length : ''}</span>
          <div style={{ flex: 1 }} />
          <button className="btn icon" title="Close (Esc)" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="answers-body">
          <div className="answer-question">
            <div className="answer-label">
              <span>Card</span>
              {card.source && (
                <button className="badge source-badge" title="Show in document" disabled={!doc} onClick={() => locateCard(card)}>
                  {doc ? `${doc.title} · ` : ''}p.{card.source.page}
                </button>
              )}
            </div>
            {title && (
              <div className="answer-q-title">
                <MathText text={title} />
              </div>
            )}
            {excerpt && (
              <div className="answer-q-excerpt">
                <MathText text={excerpt} />
              </div>
            )}
            {imageUrl && <img className="answer-image" src={imageUrl} alt="" draggable={false} />}
            {!title && !excerpt && !imageUrl && <div className="muted">Untitled card</div>}
          </div>

          {answers.map((a, i) => (
            <div key={a.id} className="answer-card">
              <div className="answer-label">
                <span>Answer {i + 1}</span>
                {a.source && (
                  <button className="badge source-badge" title="Show in document" onClick={() => locateSource(a.source!)}>
                    p.{a.source.page}
                  </button>
                )}
                <div style={{ flex: 1 }} />
                {editing !== a.id && (
                  <button className="btn icon" title="Edit answer" onClick={() => edit(a)}>
                    <Icon name="pencil" size={15} />
                  </button>
                )}
                <button className="btn icon" title="Delete answer" onClick={() => remove(a)}>
                  <Icon name="trash" size={15} />
                </button>
              </div>
              {editing === a.id ? (
                <>
                  {a.imageId && <AnswerBody answer={{ ...a, text: '' }} />}
                  {editor}
                </>
              ) : (
                <AnswerBody answer={a} />
              )}
            </div>
          ))}

          {editing === NEW && (
            <div className="answer-card">
              <div className="answer-label">
                <span>Answer {answers.length + 1}</span>
              </div>
              {editor}
            </div>
          )}

          {!answers.length && editing !== NEW && (
            <div className="answers-empty muted">
              No answers yet. Write one here, or select the card and then text in the document and choose <b>Answer</b> in the
              popup (hold Alt with the area tool for a picture answer).
            </div>
          )}
        </div>

        <div className="answers-foot">
          <button className="btn outline" disabled={editing === NEW} onClick={() => edit()}>
            <Icon name="plus" size={15} /> Add answer
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
