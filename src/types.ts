export const COLORS = ['yellow', 'green', 'blue', 'red', 'purple', 'orange', 'gray'] as const;
export type ColorKey = (typeof COLORS)[number];

/** A rectangle on a page, normalized to 0..1 of the page's width/height. */
export interface PageRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a card's excerpt came from in a document. */
export interface SourceAnchor {
  docId: string;
  page: number;
  kind: 'text' | 'area';
  rects: PageRect[];
}

export interface ReviewState {
  due: number;
  interval: number; // days
  ease: number;
  reps: number;
  lapses: number;
  last?: number;
}

/**
 * An answer attached to a card. Answers stay out of the map; the card's Answer button opens
 * them in a window together with the card, and they are on the back of its flashcard.
 */
export interface AnswerCard {
  id: string;
  /** Text with optional LaTeX. */
  text: string;
  /** A picture answer (area excerpt). */
  imageId?: string;
  /** Where it was excerpted from, when it came from a document. */
  source?: SourceAnchor;
  createdAt: number;
}

export interface Card {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  excerpt: string;
  /** Text found under an area excerpt; used for search/export, not shown on the card. */
  imageText?: string;
  imageId?: string;
  comment: string;
  color: ColorKey;
  tags: string[];
  source?: SourceAnchor;
  collapsed?: boolean;
  review?: ReviewState;
  /**
   * Free placement in the mind map. For a root card this is its absolute position;
   * for a child it is relative to its parent's top-left corner. Absent = automatic layout.
   */
  mapPos?: { x: number; y: number };
  /** The group (see `Notebook.groups`) this card belongs to. */
  groupId?: string;
  answers?: AnswerCard[];
  createdAt: number;
  updatedAt: number;
}

export type CardMap = Record<string, Card>;

/** A named, coloured set of cards, drawn as a frame around them in the mind map and on the whiteboard. */
export interface CardGroup {
  id: string;
  name: string;
  color: ColorKey;
}

// ---------------------------------------------------------------------------
// Whiteboard: a free canvas holding placed cards plus drawings, shapes, text
// and arrows. Coordinates are canvas units (1 = 1px at 100% zoom).
// ---------------------------------------------------------------------------

/** 'ink' follows the theme's text colour (dark on light, light on dark). */
export type InkColor = ColorKey | 'ink';

interface BoardItemBase {
  id: string;
}

/** A notebook card placed on the board (the card itself lives in `cards`). */
export interface BoardCardItem extends BoardItemBase {
  type: 'card';
  cardId: string;
  x: number;
  y: number;
  w: number;
}

/** Freehand pen / highlighter stroke; points are relative to (x, y). */
export interface BoardStroke extends BoardItemBase {
  type: 'stroke';
  x: number;
  y: number;
  points: number[];
  color: InkColor;
  size: number;
  highlighter?: boolean;
}

export interface BoardShape extends BoardItemBase {
  type: 'shape';
  shape: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  color: InkColor;
  size: number;
  fill: boolean;
}

export interface BoardText extends BoardItemBase {
  type: 'text';
  x: number;
  y: number;
  w: number;
  text: string;
  color: InkColor;
  fontSize: number;
}

/** An arrow end is either a free point or attached to another item (it then follows that item). */
export interface ArrowEnd {
  x: number;
  y: number;
  itemId?: string;
}

export interface BoardArrow extends BoardItemBase {
  type: 'arrow';
  from: ArrowEnd;
  to: ArrowEnd;
  color: InkColor;
  size: number;
}

export type BoardItem = BoardCardItem | BoardStroke | BoardShape | BoardText | BoardArrow;

export interface Board {
  /** Back-to-front drawing order. */
  items: BoardItem[];
}

export const EMPTY_BOARD: Board = { items: [] };

// ---------------------------------------------------------------------------
// Document marks: ink, text and notes written on top of a document page.
// Positions and sizes are fractions of the page (x and widths of its width,
// y of its height), so they follow the zoom. They belong to the notebook.
// ---------------------------------------------------------------------------

interface DocMarkBase {
  id: string;
  docId: string;
  page: number;
}

/** Pen or highlighter stroke. */
export interface DocInk extends DocMarkBase {
  type: 'ink';
  /** x, y pairs. */
  points: number[];
  color: InkColor;
  /** Stroke width, as a fraction of the page width. */
  size: number;
  highlighter?: boolean;
}

/** Text typed onto the page. */
export interface DocText extends DocMarkBase {
  type: 'text';
  x: number;
  y: number;
  w: number;
  text: string;
  color: InkColor;
  /** Font size, as a fraction of the page width. */
  fontSize: number;
  /** Paints over what is under it (to correct the document's text). */
  cover?: boolean;
}

/** A sticky note: an icon on the page that opens to show its text. */
export interface DocNote extends DocMarkBase {
  type: 'note';
  x: number;
  y: number;
  text: string;
  color: ColorKey;
}

export type DocMark = DocInk | DocText | DocNote;

export interface Notebook {
  version: 1;
  id: string;
  title: string;
  docIds: string[];
  cards: CardMap;
  board?: Board;
  groups?: CardGroup[];
  /** Ink, text and notes on the documents' pages. */
  marks?: DocMark[];
  createdAt: number;
  updatedAt: number;
}

export interface DocMeta {
  id: string;
  title: string;
  fileName: string;
  pageCount: number;
  size: number;
  hash: string;
  thumbId?: string;
  addedAt: number;
}

export interface NotebookMeta {
  id: string;
  title: string;
  docIds: string[];
  cardCount: number;
  /** Due timestamps of cards in review, so the library can show due counts without loading notebooks. */
  reviewDues: number[];
  createdAt: number;
  updatedAt: number;
  openedAt: number;
}

export interface LibraryData {
  version: 1;
  docs: DocMeta[];
  notebooks: NotebookMeta[];
}
