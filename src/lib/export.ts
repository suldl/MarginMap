import { backend } from '../backend';
import type { AnswerCard, Card, DocMeta, DocNote, DocText, Notebook } from '../types';
import { buildTree } from './tree';

export type ExportFormat = 'markdown' | 'opml' | 'json';

function docName(docs: DocMeta[], id: string | undefined) {
  return docs.find((d) => d.id === id)?.title ?? 'Unknown document';
}

function sourceLabel(c: Card, docs: DocMeta[]) {
  return c.source ? `${docName(docs, c.source.docId)}, p. ${c.source.page}` : '';
}

function answerText(a: AnswerCard, docs: DocMeta[]) {
  const text = a.text.trim().replace(/\n+/g, ' ') || (a.imageId ? '(picture)' : '');
  return a.source ? `${text} — ${docName(docs, a.source.docId)}, p. ${a.source.page}` : text;
}

export function toMarkdown(nb: Notebook, docs: DocMeta[]): string {
  const tree = buildTree(nb.cards);
  const lines: string[] = [`# ${nb.title}`, ''];
  const walk = (list: Card[], depth: number) => {
    for (const c of list) {
      const pad = '  '.repeat(depth);
      const inner = '  '.repeat(depth + 1);
      const head = c.title.trim() ? `**${c.title.trim()}**` : c.excerpt.trim() ? '' : c.imageId ? '*(image excerpt)*' : '*(untitled)*';
      const excerptInline = !c.title.trim() && c.excerpt.trim();
      lines.push(`${pad}- ${excerptInline ? c.excerpt.trim() : head}`);
      if (c.title.trim() && c.excerpt.trim()) {
        for (const l of c.excerpt.trim().split('\n')) lines.push(`${inner}> ${l}`);
      }
      if (c.imageId && c.imageText?.trim()) lines.push(`${inner}> ${c.imageText.trim().replace(/\n/g, ' ')}`);
      if (c.source) lines.push(`${inner}*— ${sourceLabel(c, docs)}*`);
      if (c.comment.trim()) {
        lines.push('');
        for (const l of c.comment.trim().split('\n')) lines.push(`${inner}${l}`);
      }
      for (const a of c.answers ?? []) lines.push(`${inner}**Answer:** ${answerText(a, docs)}`);
      if (c.tags.length) lines.push(`${inner}${c.tags.map((t) => `#${t.replace(/\s+/g, '_')}`).join(' ')}`);
      walk(tree.children.get(c.id) ?? [], depth + 1);
    }
  };
  walk(tree.roots, 0);
  // Text and sticky notes written on the documents' pages.
  const written = (nb.marks ?? [])
    .filter((m): m is DocText | DocNote => m.type !== 'ink' && !!m.text.trim())
    .sort((a, b) => docName(docs, a.docId).localeCompare(docName(docs, b.docId)) || a.page - b.page || a.y - b.y);
  if (written.length) {
    lines.push('', '## Notes in the documents', '');
    for (const m of written) {
      lines.push(`- *${docName(docs, m.docId)}, p. ${m.page}${m.type === 'note' ? ' (note)' : ''}:* ${m.text.trim().replace(/\n+/g, ' ')}`);
    }
  }
  return lines.join('\n') + '\n';
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');

export function toOpml(nb: Notebook, docs: DocMeta[]): string {
  const tree = buildTree(nb.cards);
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `  <head><title>${xml(nb.title)}</title></head>`,
    '  <body>',
  ];
  const walk = (list: Card[], depth: number) => {
    for (const c of list) {
      const pad = '    ' + '  '.repeat(depth);
      const text = c.title.trim() || c.excerpt.trim() || (c.imageId ? 'Image excerpt' : 'Untitled');
      const answers = (c.answers ?? []).map((a) => `Answer: ${answerText(a, docs)}`).join('\n');
      const note = [c.title.trim() ? c.excerpt.trim() : '', c.comment.trim(), answers, sourceLabel(c, docs)].filter(Boolean).join('\n\n');
      const kids = tree.children.get(c.id) ?? [];
      const attrs = `text="${xml(text)}"${note ? ` _note="${xml(note)}"` : ''}`;
      if (kids.length) {
        out.push(`${pad}<outline ${attrs}>`);
        walk(kids, depth + 1);
        out.push(`${pad}</outline>`);
      } else {
        out.push(`${pad}<outline ${attrs}/>`);
      }
    }
  };
  walk(tree.roots, 0);
  out.push('  </body>', '</opml>');
  return out.join('\n') + '\n';
}

function safeFileName(s: string) {
  return s.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120) || 'notebook';
}

export async function exportNotebook(nb: Notebook, docs: DocMeta[], format: ExportFormat): Promise<boolean> {
  const base = safeFileName(nb.title);
  if (format === 'markdown') {
    return backend.saveFile(`${base}.md`, toMarkdown(nb, docs), [{ name: 'Markdown', extensions: ['md'] }]);
  }
  if (format === 'opml') {
    return backend.saveFile(`${base}.opml`, toOpml(nb, docs), [{ name: 'OPML outline', extensions: ['opml'] }]);
  }
  return backend.saveFile(`${base}.marginmap.json`, JSON.stringify(nb, null, 2), [{ name: 'JSON', extensions: ['json'] }]);
}
