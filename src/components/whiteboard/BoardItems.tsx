import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import type { BoardArrow, BoardCardItem, BoardShape, BoardStroke, BoardText, Card } from '../../types';
import { CardBody } from '../CardBody';
import { MathText } from '../MathText';
import { arrowHead, arrowPoints, inkVar, strokePath, type Box } from './geometry';

type Report = (id: string, w: number, h: number) => void;

function useMeasure(id: string, report: Report) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    report(id, el.offsetWidth, el.offsetHeight);
    const ro = new ResizeObserver(() => report(id, el.offsetWidth, el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [id, report]);
  return ref;
}

export const BoardCard = memo(function BoardCard({
  item,
  card,
  editing,
  faded,
  flashNonce,
  report,
}: {
  item: BoardCardItem;
  card: Card;
  editing: boolean;
  faded: boolean;
  flashNonce: number;
  report: Report;
}) {
  const ref = useMeasure(item.id, report);
  useEffect(() => {
    const el = ref.current;
    if (!el || !flashNonce) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    const t = setTimeout(() => el.classList.remove('flash'), 1300);
    return () => clearTimeout(t);
  }, [flashNonce, ref]);
  return (
    <div
      ref={ref}
      className={`card-node wb-card ${card.parentId === null ? 'root' : ''}`}
      style={
        {
          transform: `translate(${item.x}px, ${item.y}px)`,
          width: item.w,
          opacity: faded ? 0.3 : undefined,
          '--cc': `var(--c-${card.color})`,
        } as React.CSSProperties
      }
    >
      <CardBody card={card} editing={editing} structural={false} />
    </div>
  );
});

export const BoardTextView = memo(function BoardTextView({ item, faded, report }: { item: BoardText; faded: boolean; report: Report }) {
  const ref = useMeasure(item.id, report);
  return (
    <div
      ref={ref}
      className="wb-text"
      style={{
        transform: `translate(${item.x}px, ${item.y}px)`,
        width: item.w,
        color: inkVar(item.color),
        fontSize: item.fontSize,
        opacity: faded ? 0.3 : undefined,
      }}
    >
      <MathText text={item.text} />
    </div>
  );
});

export function ShapeView({ item, faded }: { item: BoardShape; faded: boolean }) {
  const color = inkVar(item.color);
  const fill = item.fill ? `color-mix(in srgb, ${color} 22%, transparent)` : 'none';
  return (
    <svg className="wb-svg" width="1" height="1" opacity={faded ? 0.3 : 1}>
      {item.shape === 'rect' ? (
        <rect x={item.x} y={item.y} width={item.w} height={item.h} rx={6} fill={fill} stroke={color} strokeWidth={item.size} />
      ) : (
        <ellipse
          cx={item.x + item.w / 2}
          cy={item.y + item.h / 2}
          rx={item.w / 2}
          ry={item.h / 2}
          fill={fill}
          stroke={color}
          strokeWidth={item.size}
        />
      )}
    </svg>
  );
}

export function StrokeView({ item, faded }: { item: BoardStroke; faded: boolean }) {
  return (
    <svg className={`wb-svg ${item.highlighter ? 'marker' : ''}`} width="1" height="1" opacity={faded ? 0.3 : 1}>
      <path
        transform={`translate(${item.x} ${item.y})`}
        d={strokePath(item.points)}
        fill="none"
        stroke={inkVar(item.color)}
        strokeOpacity={item.highlighter ? 0.38 : 1}
        strokeWidth={item.size}
        strokeLinecap={item.highlighter ? 'square' : 'round'}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowView({ item, resolve, faded }: { item: BoardArrow; resolve: (id: string) => Box | null; faded: boolean }) {
  const [a, b] = arrowPoints(item, resolve);
  const color = inkVar(item.color);
  return (
    <svg className="wb-svg" width="1" height="1" opacity={faded ? 0.3 : 1}>
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={item.size} strokeLinecap="round" />
      <polygon points={arrowHead(a, b, item.size)} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />
    </svg>
  );
}
