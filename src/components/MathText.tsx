import { Fragment, memo, useMemo } from 'react';
import { mayHaveMath, renderTex, splitMath } from '../lib/math';
import { useSettings } from '../store/settings';

/**
 * Text with LaTeX formulas ($…$, $$…$$, \(…\), \[…\]) rendered by KaTeX.
 * Plain text stays plain React text; only KaTeX's own output is injected as HTML.
 */
export const MathText = memo(function MathText({ text }: { text: string }) {
  const enabled = useSettings((s) => s.math);
  const segments = useMemo(() => (enabled && mayHaveMath(text) ? splitMath(text) : null), [text, enabled]);
  if (!segments || !segments.some((s) => s.kind === 'math')) return <>{text}</>;
  return (
    <>
      {segments.map((s, i) =>
        s.kind === 'text' ? (
          <Fragment key={i}>{s.text}</Fragment>
        ) : (
          <span key={i} className={s.display ? 'math math-display' : 'math'} dangerouslySetInnerHTML={{ __html: renderTex(s.tex, s.display) }} />
        ),
      )}
    </>
  );
});
