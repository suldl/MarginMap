import { useCallback, useRef, useState } from 'react';

export type SizeMap = Map<string, { w: number; h: number }>;

/** Collects element sizes reported by children, batched into one state update per frame. */
export function useSizes() {
  const [sizes, setSizes] = useState<SizeMap>(() => new Map());
  const pending = useRef<SizeMap>(new Map());
  const raf = useRef(0);
  const report = useCallback((id: string, w: number, h: number) => {
    pending.current.set(id, { w, h });
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const batch = pending.current;
      pending.current = new Map();
      setSizes((prev) => {
        let next: SizeMap | null = null;
        for (const [k, v] of batch) {
          const o = prev.get(k);
          if (!o || Math.abs(o.w - v.w) > 0.5 || Math.abs(o.h - v.h) > 0.5) {
            next ??= new Map(prev);
            next.set(k, v);
          }
        }
        return next ?? prev;
      });
    });
  }, []);
  return [sizes, report] as const;
}
