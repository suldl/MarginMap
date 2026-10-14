// End-to-end smoke test: drives the built Electron app with Playwright through
// the core study loop (import → excerpt → mind map → review) and checks persistence.
//
//   npm run test:e2e                      # against the dev build in dist/
//   EXE=release/win-unpacked/MarginMap.exe node tests/smoke.mjs   # against a packaged build
//
// Screenshots land in tests/output/. Uses a throwaway data folder, never your real library.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tests', 'output');
const dataDir = path.join(outDir, 'data');
const fixture = path.join(root, 'tests', 'fixtures', 'cell-biology.pdf');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) failures++;
};

async function launch(env = {}) {
  const exe = process.env.EXE ? path.resolve(root, process.env.EXE) : null;
  const app = await electron.launch({
    executablePath: exe ?? electronPath,
    args: exe ? [] : ['.'],
    cwd: root,
    env: { ...process.env, MARGINMAP_DATA_DIR: dataDir, VITE_DEV_SERVER_URL: '', ...env },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => check(`no page errors (${e.message})`, false));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900));
  await win.waitForSelector('.titlebar', { timeout: 20000 });
  return { app, win };
}

let shotNo = 0;
const shot = (win, name) => win.screenshot({ path: path.join(outDir, `${String(++shotNo).padStart(2, '0')}-${name}.png`) });

async function dragSelect(win, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  await win.mouse.move(a.x + 1, a.y + a.height / 2);
  await win.mouse.down();
  await win.mouse.move(b.x + b.width - 1, b.y + b.height / 2, { steps: 10 });
  await win.mouse.up();
  await win.waitForSelector('.float-toolbar', { timeout: 5000 });
}

function savedCards() {
  const dir = path.join(dataDir, 'notebooks');
  const [file] = fs.readdirSync(dir);
  return Object.values(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')).cards);
}

// ---- pass 1: build a notebook -------------------------------------------------
{
  const { app, win } = await launch();
  try {
    await win.setInputFiles('.titlebar input[type=file]', fixture);
    await win.waitForSelector('.lib-section .tile', { timeout: 15000 });
    await shot(win, 'library');
    await win.locator('.lib-section').nth(1).locator('.tile').first().click();
    await win.waitForSelector('.pdf-page[data-page="1"] .textLayer span', { timeout: 15000 });

    const spans = win.locator('.pdf-page[data-page="1"] .textLayer > span');
    await dragSelect(win, spans.nth(1), spans.nth(3));
    await win.locator('.float-toolbar .swatch').nth(1).click();
    await win.waitForSelector('.card-node');
    check('text excerpt creates a card', (await win.locator('.card-node').count()) === 1);
    check('text excerpt draws a highlight', (await win.locator('.pdf-page[data-page="1"] .hl').count()) > 0);

    await win.locator('.card-node').first().click();
    await win.keyboard.press('Tab');
    await win.keyboard.type('Two kinds of cells');
    await win.keyboard.press('Enter');
    check('Tab adds a titled child card', (await win.locator('.card-node', { hasText: 'Two kinds of cells' }).count()) === 1);

    await win.locator('.card-node').first().click();
    await dragSelect(win, spans.nth(5), spans.nth(7));
    await win.locator('.float-toolbar .swatch').nth(2).click();
    check('excerpt with a selected card becomes its child', (await win.locator('.card-node').count()) === 3);

    await win.locator('button[title^="Area excerpt"]').click();
    await win.locator('.pdf-page[data-page="2"]').scrollIntoViewIfNeeded();
    await win.waitForTimeout(500);
    const label = await win.locator('.pdf-page[data-page="2"] .textLayer span', { hasText: 'Nucleus' }).first().boundingBox();
    await win.mouse.move(label.x - 40, label.y - 40);
    await win.mouse.down();
    await win.mouse.move(label.x + 260, label.y + 80, { steps: 10 });
    await win.mouse.up();
    await win.waitForSelector('.card-image', { timeout: 8000 });
    check('area excerpt creates an image card', true);
    await win.locator('button[title^="Select text"]').click();
    await shot(win, 'study');

    await win.locator('.card-node', { hasText: 'Two kinds of cells' }).click();
    await win.locator('.inspector .switch').click();
    await win.locator('.titlebar .btn', { hasText: 'Review' }).click();
    await win.waitForSelector('.flashcard', { timeout: 8000 });
    await win.keyboard.press('Space');
    await shot(win, 'review');
    await win.keyboard.press('3');
    await win.waitForSelector('text=Session complete');
    check('review session completes', true);
    await win.locator('.titlebar .btn', { hasText: 'Back' }).click();
    await win.waitForSelector('.card-node');
    await win.waitForTimeout(800);
  } catch (err) {
    check(`pass 1 ran without errors: ${err.message}`, false);
    await shot(win, 'failure-pass1').catch(() => {});
  } finally {
    await app.close();
  }
}

const cards = savedCards();
check(`4 cards saved to disk (got ${cards.length})`, cards.length === 4);
const reviewed = cards.find((c) => c.title === 'Two kinds of cells');
check('graded card was rescheduled ~1 day out', !!reviewed?.review && reviewed.review.due - Date.now() > 20 * 3600e3);

// ---- pass 2: reopen, reorganize, navigate -------------------------------------------
{
  const { app, win } = await launch();
  try {
    await win.locator('.lib-section').first().locator('.tile').first().click();
    await win.waitForSelector('.card-node');
    await win.waitForSelector('.pdf-page[data-page="1"] canvas');
    await win.locator('button[title="Fit to screen"]').click();
    await win.waitForTimeout(400);
    check('notebook reopens with its cards', (await win.locator('.card-node').count()) === 4);

    const src = await win.locator('.card-node', { hasText: 'Two kinds of cells' }).boundingBox();
    const dst = await win.locator('.card-node:has(.card-image)').boundingBox();
    await win.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await win.mouse.down();
    await win.mouse.move(dst.x + dst.width / 2, dst.y + dst.height / 2, { steps: 15 });
    await win.mouse.up();
    await win.waitForTimeout(400);

    await win.locator('.card-node:has(.card-image)').click();
    await win.waitForTimeout(900);
    check('clicking a card jumps the reader to its page', (await win.locator('.page-indicator input').inputValue()) === '2');

    await win.locator('.page-indicator input').fill('1');
    await win.locator('.page-indicator input').press('Enter');
    await win.waitForTimeout(500);
    const hl = await win.locator('.pdf-page[data-page="1"] .hl').first().boundingBox();
    await win.mouse.click(hl.x + 30, hl.y + hl.height / 2);
    await win.waitForTimeout(400);
    const excerpt = await win.locator('.inspector textarea').first().inputValue();
    check('clicking a highlight selects its card', excerpt.startsWith('The cell is the smallest'));

    await win.locator('button[title="Table of contents"]').click();
    await win.locator('.toc-item', { hasText: '4. Cell Division' }).click();
    await win.waitForTimeout(600);
    check('table of contents navigates', (await win.locator('.page-indicator input').inputValue()) === '4');

    await win.emulateMedia({ colorScheme: 'dark' });
    await shot(win, 'dark');
    await win.locator('button[title="Back to library"]').click();
    await win.waitForSelector('.tile');
  } catch (err) {
    check(`pass 2 ran without errors: ${err.message}`, false);
    await shot(win, 'failure-pass2').catch(() => {});
  } finally {
    await app.close();
  }
}

const moved = savedCards();
const child = moved.find((c) => c.title === 'Two kinds of cells');
const parent = moved.find((c) => c.id === child?.parentId);
check('drag & drop re-parenting persisted', !!parent?.imageId);

// ---- pass 3: enlarged cards, panning, tabs, whiteboard ------------------------------------
{
  const { app, win } = await launch();
  const count = (sel) => win.locator(sel).count();
  try {
    await win.locator('.lib-section').first().locator('.tile').first().click();
    await win.waitForSelector('.card-node');
    await win.locator('button[title="Mind map view"]').click();
    await win.locator('button[title="Fit to screen"]').click();
    await win.waitForTimeout(400);

    // Clicking a card shows it enlarged; Esc closes it.
    await win.locator('.card-node:has(.card-image)').click();
    await win.waitForSelector('.card-preview', { timeout: 3000 });
    check('clicking a card opens the enlarged view', (await count('.card-preview .card-preview-image')) === 1);
    await shot(win, 'enlarged-card');
    await win.keyboard.press('Escape');
    check('Esc closes the enlarged view', (await count('.card-preview')) === 0);

    // Right-dragging pans the canvas, without selecting the hint / zoom text or opening a menu.
    const map = await win.locator('.mindmap').boundingBox();
    const transform = () => win.locator('.mindmap .mm-canvas').evaluate((el) => el.style.transform);
    const t0 = await transform();
    await win.mouse.move(map.x + map.width - 30, map.y + 30);
    await win.mouse.down({ button: 'right' });
    await win.mouse.move(map.x + 20, map.y + map.height - 8, { steps: 12 });
    await win.mouse.up({ button: 'right' });
    await win.waitForTimeout(150);
    const selected = await win.evaluate(() => String(window.getSelection()));
    check(`panning the map selects no text (got "${selected.slice(0, 30)}")`, selected === '');
    check('right-drag pans the map', (await transform()) !== t0 && (await count('.menu')) === 0);

    // Middle-click closes a document tab; it can be added back from the + menu.
    await win.locator('.doc-tab').first().click({ button: 'middle' });
    await win.waitForTimeout(300);
    check('middle-click closes the tab', (await count('.doc-tab')) === 0);
    await win.locator('button[title="Add document"]').click();
    await win.locator('.menu-item', { hasText: 'cell-biology' }).click();
    check('document can be re-added', (await count('.doc-tab')) === 1);

    // Whiteboard.
    await win.locator('button[title="Mind map only"]').click();
    await win.locator('button[title="Card panel"]').click();
    await win.locator('button[title="Whiteboard view"]').click();
    await win.waitForSelector('.whiteboard');
    await win.locator('.map-hud .btn', { hasText: 'Cards' }).click();
    await win.locator('.wb-tray .btn', { hasText: 'Add all' }).click();
    await win.waitForTimeout(300);
    check(`"Add all" puts every card on the board (${await count('.wb-card')})`, (await count('.wb-card')) === 4);
    await win.locator('.wb-tray button[title="Close"]').click();
    await win.locator('.whiteboard button[title="Fit to screen"]').click();
    await win.waitForTimeout(300);
    await win.locator('.whiteboard button[title="Zoom out"]').click();
    await win.waitForTimeout(300);

    const wb = await win.locator('.whiteboard').boundingBox();
    const bottomY = wb.y + wb.height - 150;
    const svgCount = () => count('.whiteboard .wb-svg');
    const before = await svgCount();

    await win.keyboard.press('p');
    await win.mouse.move(wb.x + 150, bottomY);
    await win.mouse.down();
    for (let i = 1; i <= 12; i++) await win.mouse.move(wb.x + 150 + i * 15, bottomY + Math.sin(i / 2) * 25);
    await win.mouse.up();
    check('pen draws a stroke', (await svgCount()) === before + 1);

    await win.keyboard.press('r');
    await win.mouse.move(wb.x + 420, bottomY - 30);
    await win.mouse.down();
    await win.mouse.move(wb.x + 560, bottomY + 40, { steps: 6 });
    await win.mouse.up();
    check('rectangle tool draws a shape', (await count('.whiteboard .wb-svg rect')) === 1);

    // Connect two cards with an arrow, then move one: the arrow must follow.
    const c1 = await win.locator('.wb-card').nth(0).boundingBox();
    const c2 = await win.locator('.wb-card').nth(1).boundingBox();
    await win.keyboard.press('a');
    await win.mouse.move(c1.x + c1.width / 2, c1.y + c1.height / 2);
    await win.mouse.down();
    await win.mouse.move(c2.x + c2.width / 2, c2.y + c2.height / 2, { steps: 8 });
    await win.mouse.up();
    const arrowLine = win.locator('.whiteboard .wb-svg line').first();
    check('arrow connects two cards', (await count('.whiteboard .wb-svg line')) === 1);
    const x2Before = Number(await arrowLine.getAttribute('x2'));
    await win.mouse.move(c2.x + c2.width / 2, c2.y + 12);
    await win.mouse.down();
    await win.mouse.move(c2.x + c2.width / 2 + 60, c2.y + 72, { steps: 6 });
    await win.mouse.up();
    const x2After = Number(await arrowLine.getAttribute('x2'));
    check(`arrow follows a moved card (${x2Before.toFixed(0)} -> ${x2After.toFixed(0)})`, Math.abs(x2After - x2Before) > 20);

    await win.keyboard.press('t');
    await win.mouse.click(wb.x + 650, bottomY);
    await win.keyboard.type('Key idea');
    await win.keyboard.press('Escape');
    check('text tool adds a label', (await win.locator('.wb-text', { hasText: 'Key idea' }).count()) === 1);
    await win.keyboard.press('Control+z');
    check('undo removes the label', (await win.locator('.wb-text').count()) === 0);
    await win.keyboard.press('Control+y');
    check('redo restores it', (await win.locator('.wb-text').count()) === 1);

    // Clicking a card on the board shows it enlarged as well.
    const c3 = await win.locator('.wb-card').nth(2).boundingBox();
    await win.mouse.click(c3.x + c3.width / 2, c3.y + 10);
    await win.waitForTimeout(300);
    check('clicking a board card opens the enlarged view', (await count('.card-preview')) === 1);
    await shot(win, 'whiteboard');
    await win.keyboard.press('Escape');

    // Erase the pen stroke.
    const strokesBefore = await count('.whiteboard .wb-svg path');
    await win.keyboard.press('e');
    await win.mouse.move(wb.x + 140, bottomY - 40);
    await win.mouse.down();
    await win.mouse.move(wb.x + 260, bottomY + 40, { steps: 20 });
    await win.mouse.up();
    check('eraser removes the stroke', (await count('.whiteboard .wb-svg path')) === strokesBefore - 1);
    await win.keyboard.press('v');

    // Excerpting while the whiteboard is showing places the new card on it.
    await win.locator('button[title="Document + mind map"]').click();
    await win.waitForSelector('.pdf-page canvas');
    await win.locator('.page-indicator input').fill('3');
    await win.locator('.page-indicator input').press('Enter');
    await win.waitForSelector('.pdf-page[data-page="3"] .textLayer span');
    const p3 = win.locator('.pdf-page[data-page="3"] .textLayer > span');
    await dragSelect(win, p3.nth(1), p3.nth(2));
    await win.locator('.float-toolbar .swatch').nth(4).click();
    await win.waitForTimeout(300);
    check('new excerpt lands on the open whiteboard', (await count('.wb-card')) === 5);
    await win.waitForTimeout(800);
    await win.locator('button[title="Back to library"]').click();
    await win.waitForSelector('.tile');
  } catch (err) {
    check(`pass 3 ran without errors: ${err.message}`, false);
    await shot(win, 'failure-pass3').catch(() => {});
  } finally {
    await app.close();
  }
}

{
  const dir = path.join(dataDir, 'notebooks');
  const nb = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
  const types = (nb.board?.items ?? []).map((i) => i.type).sort().join(',');
  check(`whiteboard saved to disk (${types})`, types === 'arrow,card,card,card,card,card,shape,text');
}

// ---- pass 4 (v0.5): settings, updates, formulas, selection, groups, free placement, eraser ----
{
  // A local release feed stands in for GitHub.
  const feed = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: '9.9.9', url: 'https://example.com/marginmap', notes: 'Shiny new things' }));
  });
  await new Promise((r) => feed.listen(0, '127.0.0.1', r));
  const { app, win } = await launch({ MARGINMAP_UPDATE_URL: `http://127.0.0.1:${feed.address().port}/latest.json` });
  const count = (sel) => win.locator(sel).count();
  try {
    // The dialog's Cancel button is a normal-sized secondary button.
    await win.locator('.titlebar .btn', { hasText: 'New notebook' }).click();
    const cancel = await win.locator('.modal .btn', { hasText: 'Cancel' }).boundingBox();
    check(`Cancel button has normal size (${Math.round(cancel.width)}x${Math.round(cancel.height)})`, cancel.height <= 32 && cancel.width < 120);
    await win.keyboard.press('Escape');

    // Settings: theme and accent apply at once.
    await win.keyboard.press('Control+,');
    await win.waitForSelector('.modal.settings');
    await win.locator('.set-row .btn', { hasText: 'Dark' }).click();
    await win.locator('button[aria-label="Violet accent"]').click();
    const look = await win.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    }));
    check(`settings switch theme and accent (${look.theme}, ${look.accent})`, look.theme === 'dark' && look.accent === '#a385ff');
    await shot(win, 'settings');
    await win.locator('.set-row .btn', { hasText: 'System' }).click();
    await win.locator('button[aria-label="Blue accent"]').click();

    // Check for updates against the local feed.
    await win.locator('.settings-tab', { hasText: 'Updates' }).click();
    await win.locator('.update-card .btn', { hasText: 'Check for updates' }).click();
    await win.waitForSelector('.update-status:has-text("9.9.9 is available")', { timeout: 8000 });
    check('check for updates finds the newer version', (await count('.update-card .btn:has-text("Download")')) === 1);
    await shot(win, 'updates');
    await win.keyboard.press('Escape');
    check('Esc closes the settings', (await count('.modal.settings')) === 0);

    await win.locator('.lib-section').first().locator('.tile').first().click();
    await win.waitForSelector('.card-node');
    await win.locator('button[title="Mind map only"]').click();
    await win.locator('button[title="Mind map view"]').click();
    await win.waitForSelector('.mindmap .card-node');
    if (!(await count('.inspector'))) await win.locator('button[title="Card panel"]').click();
    await win.locator('.mindmap button[title="Fit to screen"]').click();
    await win.waitForTimeout(400);

    // Formulas in titles render with KaTeX.
    await win.locator('.card-node', { hasText: 'Two kinds of cells' }).click();
    await win.keyboard.press('Escape');
    await win.locator('.inspector input.input').first().fill('Two kinds of cells $E=mc^2$');
    await win.waitForSelector('.card-node .card-title .katex');
    check('LaTeX in a title renders as a formula', (await count('.inspector .math-preview .katex')) === 1);

    // LaTeX autocomplete in the notes: \fra → \frac{}{}, Tab moves between the slots.
    const notes = win.locator('.inspector textarea').nth(1);
    await notes.click();
    await win.keyboard.type('$\\fra');
    await win.waitForSelector('.tex-assist');
    const first = await win.locator('.tex-item.on .tex-name').textContent();
    check(`autocomplete suggests \\frac (got ${first})`, first === '\\frac');
    await shot(win, 'latex-autocomplete');
    await win.keyboard.press('Enter');
    await win.keyboard.type('a');
    await win.keyboard.press('Tab');
    await win.keyboard.type('b');
    await win.keyboard.press('Tab');
    await win.keyboard.type('$');
    const typed = await notes.inputValue();
    check(`snippet tab stops fill \\frac{a}{b} (got ${typed})`, typed === '$\\frac{a}{b}$');
    await win.waitForSelector('.card-node .card-comment .katex');

    // Drag a selection box over the whole map, then group the cards.
    await win.locator('.mindmap button[title="Fit to screen"]').click();
    await win.waitForTimeout(400);
    const mm = await win.locator('.mindmap').boundingBox();
    await win.mouse.move(mm.x + 12, mm.y + 12);
    await win.mouse.down();
    await win.mouse.move(mm.x + mm.width - 12, mm.y + mm.height - 70, { steps: 12 });
    await win.mouse.up();
    const nCards = await count('.mindmap .card-node');
    check(`selection box selects every card (${await count('.card-node.selected')}/${nCards})`, (await count('.card-node.selected')) === nCards);
    check('card panel switches to bulk editing', (await win.locator('.sel-summary').textContent()).includes(`${nCards} cards selected`));
    await win.keyboard.press('Control+g');
    await win.waitForSelector('.modal input');
    await win.keyboard.press('Enter');
    await win.waitForSelector('.group-label');
    check('Ctrl+G groups the selected cards', (await win.locator('.group-label').textContent()).includes('Group 1'));
    await win.keyboard.press('Escape');

    // Drag a child card into empty space: it stays there (and keeps its parent).
    const kid = win.locator('.card-node', { hasText: 'Two kinds of cells' });
    const kb = await kid.boundingBox();
    const dropX = mm.x + 60;
    const dropY = mm.y + mm.height - 150;
    await win.mouse.move(kb.x + 20, kb.y + 10);
    await win.mouse.down();
    await win.mouse.move(dropX + 20, dropY + 10, { steps: 15 });
    await win.mouse.up();
    await win.waitForTimeout(300);
    const kb2 = await kid.boundingBox();
    check(`dragging a card to empty space places it there (${Math.round(kb2.x - dropX)}, ${Math.round(kb2.y - dropY)})`, Math.abs(kb2.x - dropX) < 6 && Math.abs(kb2.y - dropY) < 6);

    // Double-clicking empty space creates a card right there.
    const nx = mm.x + mm.width - 260;
    const ny = mm.y + 40;
    await win.mouse.dblclick(nx, ny);
    await win.waitForSelector('.card-node textarea.card-edit');
    await win.keyboard.type('Free idea');
    await win.keyboard.press('Enter');
    const fb = await win.locator('.card-node', { hasText: 'Free idea' }).boundingBox();
    check('double-click creates a card at that spot', Math.abs(fb.x + 90 - nx) < 30 && Math.abs(fb.y + 20 - ny) < 30);
    await shot(win, 'free-placement');

    // Filter by colour (the page-3 excerpt is the only purple card).
    await win.locator('button[title^="Filter by"]').click();
    await win.locator('.map-filter .swatch[title="purple"]').click();
    check(`filter dims non-matching cards (${await count('.card-node:not(.dim)')} shown)`, (await count('.card-node:not(.dim)')) === 1);
    await win.locator('.map-filter .btn', { hasText: 'Select' }).click();
    check('"Select matching" selects them', (await count('.card-node.selected')) === 1);
    await win.locator('button[title^="Filter by"]').click();
    await win.locator('.map-filter .btn', { hasText: 'Clear' }).click();
    await win.keyboard.press('Escape');

    // Whiteboard: E toggles between the eraser and the last pen.
    await win.locator('button[title="Whiteboard view"]').click();
    await win.waitForSelector('.whiteboard');
    await win.locator('.whiteboard').click({ position: { x: 300, y: 20 } });
    const on = async (label) => (await win.locator(`.wb-tools button[title^="${label}"]`).getAttribute('class')).includes('on');
    await win.keyboard.press('p');
    await win.keyboard.press('e');
    const toEraser = await on('Eraser');
    await win.keyboard.press('e');
    const backToPen = await on('Pen');
    await win.keyboard.press('m');
    await win.keyboard.press('e');
    await win.keyboard.press('e');
    check('E switches pen → eraser → pen (and back to the highlighter)', toEraser && backToPen && (await on('Highlighter')));

    // Draw a stroke, then erase it with a (simulated) pen: the eraser cursor stays visible while pressed.
    const wb = await win.locator('.whiteboard').boundingBox();
    const sy = wb.y + wb.height - 110;
    await win.keyboard.press('p');
    await win.mouse.move(wb.x + 160, sy);
    await win.mouse.down();
    for (let i = 1; i <= 10; i++) await win.mouse.move(wb.x + 160 + i * 14, sy + (i % 2) * 6);
    await win.mouse.up();
    const strokes = await count('.whiteboard .wb-svg path');
    await win.keyboard.press('e');
    check('eraser hides the system cursor', (await win.locator('.whiteboard').evaluate((el) => getComputedStyle(el).cursor)) === 'none');
    const cdp = await win.context().newCDPSession(win);
    const pen = (type, x, y, extra = {}) => cdp.send('Input.dispatchMouseEvent', { type, x, y, pointerType: 'pen', ...extra });
    const px = wb.x + 230;
    await pen('mouseMoved', px, sy - 60);
    await pen('mousePressed', px, sy - 60, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 8; i++) await pen('mouseMoved', px, sy - 60 + i * 15, { button: 'left', buttons: 1 });
    const cursor = await win.locator('.wb-eraser-cursor').evaluate((el) => ({ shown: el.style.display === 'block', pressed: el.classList.contains('pressed') }));
    await pen('mouseReleased', px, sy + 60, { button: 'left', buttons: 0, clickCount: 1 });
    check(`eraser cursor stays visible while the pen is pressed (${JSON.stringify(cursor)})`, cursor.shown && cursor.pressed);
    check('pen erases the stroke', (await count('.whiteboard .wb-svg path')) === strokes - 1);
    await win.keyboard.press('v');

    // Groups show as frames on the whiteboard too; dragging the label moves every member.
    await win.locator('.whiteboard button[title="Fit to screen"]').click();
    await win.waitForTimeout(300);
    const label = await win.locator('.whiteboard .group-label').boundingBox();
    const cardsBefore = await Promise.all((await win.locator('.wb-card').all()).map((c) => c.boundingBox()));
    await win.mouse.move(label.x + label.width / 2, label.y + label.height / 2);
    await win.mouse.down();
    await win.mouse.move(label.x + label.width / 2 + 60, label.y + label.height / 2 + 40, { steps: 8 });
    await win.mouse.up();
    const cardsAfter = await Promise.all((await win.locator('.wb-card').all()).map((c) => c.boundingBox()));
    const shifted = cardsAfter.filter((b, i) => Math.round(b.x - cardsBefore[i].x) === 60 && Math.round(b.y - cardsBefore[i].y) === 40).length;
    check(`dragging a group label moves its cards on the whiteboard (${shifted}/${cardsAfter.length})`, shifted === cardsAfter.length);

    await win.waitForTimeout(800);
    await win.locator('button[title="Back to library"]').click();
    await win.waitForSelector('.tile');
  } catch (err) {
    check(`pass 4 ran without errors: ${err.message}`, false);
    await shot(win, 'failure-pass4').catch(() => {});
  } finally {
    await app.close();
    feed.close();
  }

  const dir = path.join(dataDir, 'notebooks');
  const nb = JSON.parse(fs.readFileSync(path.join(dir, fs.readdirSync(dir)[0]), 'utf8'));
  const all = Object.values(nb.cards);
  const kid = all.find((c) => c.title.startsWith('Two kinds of cells'));
  const free = all.find((c) => c.title === 'Free idea');
  check('group saved with its members', nb.groups?.length === 1 && all.filter((c) => c.groupId === nb.groups[0].id).length === all.length - 1);
  check('free position saved, parent kept', !!kid?.mapPos && !!kid.parentId);
  check('new free card saved as an independent card', !!free?.mapPos && free.parentId === null);
  check('formula notes saved', kid?.comment === '$\\frac{a}{b}$');
}

// ---- pass 5 (v0.5.1): choose the data folder — move it, move it back, start a new library, switch ----
const locationFile = path.join(dataDir, 'data-location.json');
const libFiles = (dir) => ['docs', 'notebooks', 'assets', 'library.json'].filter((e) => fs.existsSync(path.join(dir, e)));
const libraryBefore = libFiles(dataDir).join();
{
  const moved = path.join(outDir, 'Moved library');
  const fresh = path.join(outDir, 'Second library');
  const docCount = fs.readdirSync(path.join(dataDir, 'docs')).length;
  const { app, win } = await launch();
  // The native folder picker can't be driven from a test, so answer it from the main process.
  const answerFolderDialog = (dir) =>
    app.evaluate(({ dialog }, d) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [d] });
    }, dir);
  const openDataPage = async () => {
    if (!(await win.locator('.modal.settings').count())) await win.keyboard.press('Control+,');
    await win.locator('.settings-tab', { hasText: 'Data' }).click();
    await win.waitForSelector('.set-row .data-path');
  };
  const shownFolder = () => win.locator('.set-row', { hasText: 'Data folder' }).locator('.data-path').textContent();
  // Toasts outlive the reload that follows a change, so wait for the one naming the new folder.
  const toast = (text) => win.locator('.toast', { hasText: text }).waitFor({ timeout: 20000 });
  const closeSettings = async () => {
    await win.keyboard.press('Escape');
    await win.waitForSelector('.modal.settings', { state: 'detached' });
  };
  try {
    const tiles = await win.locator('.tile').count();
    await openDataPage();
    check('Settings → Data shows the data folder', (await shownFolder()) === dataDir);
    await shot(win, 'settings-data');

    // Move the library into an empty folder.
    await answerFolderDialog(moved);
    await win.locator('.set-row', { hasText: 'Data folder' }).locator('button', { hasText: 'Change' }).click();
    await win.waitForSelector('.modal.data-folder');
    check('an empty folder offers to move the library', await win.locator('.data-option.on', { hasText: 'Move my library here' }).isVisible());
    await win.waitForTimeout(300); // let the dialog finish fading in
    await shot(win, 'data-move');
    await win.locator('.modal.data-folder button', { hasText: 'Move library' }).click();
    await toast(`Library moved to ${moved}`);
    check('library files are moved to the new folder', libFiles(moved).join() === libraryBefore && fs.readdirSync(path.join(moved, 'docs')).length === docCount);
    check('the old folder no longer holds the library', libFiles(dataDir).length === 0);
    check('the choice is saved in data-location.json', JSON.parse(fs.readFileSync(locationFile, 'utf8')).dataDir === moved);
    check('Settings reopen on the Data page with the new folder', (await shownFolder()) === moved);
    await closeSettings();
    check('the library reloads from the new folder', (await win.locator('.tile').count()) === tiles);

    // "Use default" moves it back; the emptied folder goes away.
    await openDataPage();
    await win.locator('.set-row', { hasText: 'Default folder' }).locator('button').click();
    await win.waitForSelector('.modal.data-folder');
    await win.locator('.modal.data-folder button', { hasText: 'Move library' }).click();
    await toast(`Library moved to ${dataDir}`);
    check('"Use default" moves the library back', libFiles(dataDir).join() === libraryBefore && !fs.existsSync(locationFile));
    check('the emptied folder is removed', !fs.existsSync(moved));

    // Start a new, empty library elsewhere; the old one stays put.
    await answerFolderDialog(fresh);
    await win.locator('.set-row', { hasText: 'Data folder' }).locator('button', { hasText: 'Change' }).click();
    await win.locator('.data-option', { hasText: 'Start a new' }).click();
    await win.locator('.modal.data-folder button', { hasText: 'Create library' }).click();
    await toast(`Started a new library in ${fresh}`);
    await closeSettings();
    check('a new library starts empty and the old one stays', (await win.locator('.tile').count()) === 0 && libFiles(dataDir).join() === libraryBefore);

    // Picking a folder that holds a library opens it instead of overwriting it.
    await answerFolderDialog(dataDir);
    await openDataPage();
    await win.locator('.set-row', { hasText: 'Data folder' }).locator('button', { hasText: 'Change' }).click();
    await win.waitForSelector('.modal.data-folder');
    check('a folder with a library offers to open it', (await win.locator('.modal.data-folder h3').textContent()).includes('Open this library'));
    await win.locator('.modal.data-folder button', { hasText: 'Open library' }).click();
    await toast(`Opened the library in ${dataDir}`);
    await closeSettings();
    check('switching back shows the old library again', (await win.locator('.tile').count()) === tiles && !fs.existsSync(locationFile));
  } catch (err) {
    check(`pass 5 ran without errors: ${err.message}`, false);
    await shot(win, 'failure-pass5').catch(() => {});
  } finally {
    await app.close();
  }
}

// ---- pass 6: the chosen folder has gone missing (unplugged drive) ---------------------------------
{
  const gone = path.join(outDir, 'Unplugged drive', 'MarginMap');
  fs.writeFileSync(locationFile, JSON.stringify({ dataDir: gone }));
  const { app, win } = await launch();
  try {
    await win.waitForSelector('.data-missing', { timeout: 10000 });
    check('a missing data folder shows a notice, not an empty library', (await win.locator('.data-missing .data-path').textContent()) === gone);
    await shot(win, 'data-missing');
    await win.locator('.data-missing button', { hasText: 'Try again' }).click();
    await win.waitForSelector('.toast.error', { timeout: 5000 });
    check('nothing is written to the missing folder', !fs.existsSync(gone));
    await win.locator('.data-missing button', { hasText: 'Use the default folder' }).click();
    await win.waitForSelector('.modal.data-folder');
    await win.locator('.modal.data-folder button', { hasText: 'Open library' }).click();
    await win.waitForSelector('.toast:has-text("Opened the library")', { timeout: 20000 });
    check('"Use the default folder" brings the library back', (await win.locator('.tile').count()) > 0 && !fs.existsSync(locationFile));
  } catch (err) {
    check(`pass 6 ran without errors: ${err.message}`, false);
    await shot(win, 'failure-pass6').catch(() => {});
  } finally {
    await app.close();
  }
  check('the library is intact after all the moves', libFiles(dataDir).join() === libraryBefore);
}

console.log(failures ? `\n${failures} check(s) failed — see tests/output/` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
