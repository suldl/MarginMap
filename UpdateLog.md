# Current version: v0.7.1
--------------------------------------------------

## v0.1.0 -> v0.5.0

Status: all items done in v0.5.0 (2026-10-14). `npm run test:e2e` covers each of them (53 checks, all passing).

### Features to be updated

1. [x] Whiteboard mode: switch between pen and eraser by pressing E
    - `E` toggles eraser ⇄ the pen (or the highlighter, if that was the last drawing tool).
    - Bonus: the eraser end / eraser button of a tablet pen erases while held, whatever tool is active.
2. [x] "setting" interface — gear button in the title bar, or `Ctrl+,`
    1. [x] appearance settings: theme (system / light / dark), accent color, interface size, canvas background (dots / grid / plain), mind-map connector style (curved / elbow / straight)
    2. [x] ...: mind map & board (left-drag selects or pans, enlarge cards on click), formulas (render LaTeX, autocomplete), updates, keyboard shortcuts, about (version, data folder)
3. [x] "Check for updates" feature — Settings → Updates (manual button + optional once-a-day check at startup, shown as a toast)
    - Compares with the latest GitHub release (or a JSON feed) and opens the download page; nothing installs by itself.
    - Superseded in v0.5.1 by real in-app updates (see below); the repository is now set under `build.publish` in `package.json`.
4. [x] Allow users to freely place the cards in the space.
    - Mind map: drag a card into empty space and it stays there, still connected to its parent (hold `Alt` to detach it as an independent card). Double-click empty space to create a card on that spot.
    - "Tidy up" (map toolbar / right-click) returns cards to the automatic layout. The whiteboard was already free-form.
5. [x] Support mathematical formulas in LaTeX syntax with code auto-completion feature.
    - `$…$` inline and `$$…$$` (or `\[…\]`) display formulas, rendered with KaTeX, in card titles, excerpts, notes, enlarged cards, flashcards, outline and whiteboard text; `\$` is a literal dollar.
    - Typing `\` lists ~280 commands with rendered previews; `Enter`/`Tab` inserts, and `Tab` jumps between the `{}` slots (e.g. `\frac{}{}`). Live preview under the card-panel fields.
6. [x] Multiple selection (hold down the left mouse button and drag to select), groups and classifications of cards
    - Selection: drag a box over empty space, `Ctrl`/`Shift`+click, `Ctrl+A`. Pan now with right- or middle-drag or the wheel (or switch left-drag back to panning in Settings).
    - Selected cards move, recolor, tag, review, go to the whiteboard or get deleted together; the card panel turns into a bulk editor.
    - Groups: `Ctrl+G` puts the selection in a named, colored frame (mind map and whiteboard). Click the label to select the group, drag it to move it, double-click to rename, right-click for more; `Ctrl+Shift+G` ungroups.
    - Classification: the filter button (funnel) dims everything except cards of chosen colors, tags, groups or status, and can select all matches.

### Problems

1. [x] Eraser mode: when digitizing tablet is connected and the pen is pressing on it, the eraser pointer will disappear.
    - Windows hides the system cursor while a pen touches the tablet; the eraser cursor is now drawn by the board itself, so it stays visible (and turns red while erasing). The eraser also erases everything under its circle and no longer skips items on fast strokes.
2. [x] "Cancel" button is too large and have a wrong type.
    - The outline view's CSS class (`.outline`) also matched the "outline" button style, giving Cancel a huge padding and the wrong look. Renamed the view's class; Cancel is a normal secondary button again.

### Also fixed along the way

- Switching layouts (e.g. "Mind map only" → "Document + mind map") replayed the last "jump to card" and scrolled the document away from where you were.
- Keyboard focus now returns to the mind map after a dialog (e.g. naming a group), so `Esc` and shortcuts keep working.

## v0.5.0 -> v0.5.1

### Features to be updated

1. Selected data folder

## v0.5.1 -> v0.5.2

### problems

1. click a card to enlarge -> double click a card to enlarge
2. only picture excerpt enlarge, text don't enlarge.

## v0.5.2 -> v0.7.0

1. Delete "Data folder" display in "settings -> about"
2. Add selected mouse pointer in document
3. Click a card don't locate the original text immediately.
4. Allow whiteboard, mind map and document display in same time. It means you ought to set a group of independent control button instead of "only" button like "Document+mind map" and "Document only".
5. Excerpt a whiteboard area then convert it into a card.
6. A number of "answer" card can be added to a card. When I click "answer", it will display a pop-up window to show the card and "answer" card.
7. User can edit and note in document.

## v0.7.0 -> v0.7.1

1. Text and picture excerpt in document cancel color filling.
2. Double-click to enlarge to nearly full screen.

## v0.8.0

1. Study set. feature refer marginnote4 user manual.