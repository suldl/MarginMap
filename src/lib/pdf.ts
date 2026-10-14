import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { backend } from '../backend';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy, RenderTask };
export { pdfjs };

function assetUrl(dir: string) {
  return new URL(`pdfjs/${dir}/`, document.baseURI).href;
}

export function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjs.getDocument({
    data: bytes,
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts'),
    wasmUrl: assetUrl('wasm'),
  }).promise;
}

const cache = new Map<string, Promise<PDFDocumentProxy>>();

/** Loads (and caches) a library document by id. */
export function loadPdf(docId: string): Promise<PDFDocumentProxy> {
  let p = cache.get(docId);
  if (!p) {
    p = backend.readDoc(docId).then(openPdf);
    p.catch(() => cache.delete(docId));
    cache.set(docId, p);
  }
  return p;
}

export function releaseAllPdfs() {
  for (const p of cache.values()) p.then((d) => d.destroy()).catch(() => {});
  cache.clear();
}

export function releasePdf(docId: string) {
  cache.get(docId)?.then((d) => d.destroy()).catch(() => {});
  cache.delete(docId);
}

/** Renders the whole page at `scale` into a fresh canvas. */
export async function renderPageToCanvas(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), type, quality),
  );
}

export async function renderThumbnail(pdf: PDFDocumentProxy, width = 240): Promise<Blob> {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const canvas = await renderPageToCanvas(page, width / base.width);
  return canvasToBlob(canvas, 'image/jpeg', 0.85);
}

export interface OutlineNode {
  title: string;
  page: number | null;
  children: OutlineNode[];
}

/** Resolves the PDF's table of contents to page numbers (1-based). */
export async function loadOutline(pdf: PDFDocumentProxy): Promise<OutlineNode[]> {
  const raw = await pdf.getOutline();
  if (!raw) return [];
  const resolve = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : (dest as unknown[] | null);
      if (!Array.isArray(explicit) || !explicit[0]) return null;
      const ref = explicit[0];
      if (typeof ref === 'number') return ref + 1;
      return (await pdf.getPageIndex(ref as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1;
    } catch {
      return null;
    }
  };
  type RawItem = { title: string; dest: unknown; items: RawItem[] };
  const walk = (items: RawItem[]): Promise<OutlineNode[]> =>
    Promise.all(
      items.map(async (it) => ({ title: it.title, page: await resolve(it.dest), children: await walk(it.items ?? []) })),
    );
  return walk(raw as unknown as RawItem[]);
}

const textCache = new WeakMap<PDFDocumentProxy, Map<number, Promise<string>>>();

/** Plain text of a page (cached), used for document search. */
export function pageText(pdf: PDFDocumentProxy, pageNum: number): Promise<string> {
  let m = textCache.get(pdf);
  if (!m) textCache.set(pdf, (m = new Map()));
  let p = m.get(pageNum);
  if (!p) {
    p = pdf
      .getPage(pageNum)
      .then((page) => page.getTextContent())
      .then((tc) =>
        tc.items
          .map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : ''))
          .join('')
          .replace(/\s+/g, ' '),
      );
    m.set(pageNum, p);
  }
  return p;
}
