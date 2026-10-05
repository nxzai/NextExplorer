/**
 * Content that is taller than its box, with nothing scrollable between it and
 * the first ancestor that clips.
 *
 * That is the shape of the defect reported as #10 — an editor twenty thousand
 * pixels tall inside `overflow-hidden`, with no viewport anywhere — and of
 * three others found beside it by looking for the shape rather than the case:
 * the search results, the dashboard, and a sidebar that could only be scrolled
 * by hovering it.
 *
 * Runs in the page, so it takes no imports.
 */
export const findUnreachableContent = () => {
  const scrolls = (el) => {
    const style = getComputedStyle(el);
    return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight - el.clientHeight > 4;
  };
  const clips = (el) => /(hidden|clip)/.test(getComputedStyle(el).overflowY);
  const name = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join('.')}`;

  /**
   * A box whose height comes from its own shape rather than from what is in
   * it. A square thumbnail in a fixed-height frame overflows on purpose, and
   * nobody scrolls a thumbnail — the file icon even writes the extension
   * across it, so looking for words would not tell the two apart.
   */
  const sizedByShape = (el) => getComputedStyle(el).aspectRatio !== 'auto';

  const found = [];
  for (const el of document.querySelectorAll('body *')) {
    const overflow = el.scrollHeight - el.clientHeight;
    // A block box with content below its own bottom edge. An inline box
    // reports its line height and means nothing here, and a box under 40 px
    // tall is a decoration rather than a place content lives.
    if (overflow <= 32 || el.clientHeight < 40) continue;
    const style = getComputedStyle(el);
    if (style.display.startsWith('inline')) continue;
    if (/(auto|scroll)/.test(style.overflowY)) continue;
    if (sizedByShape(el)) continue;

    let reachable = false;
    let clippedBy = null;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (scrolls(parent)) {
        reachable = true;
        break;
      }
      if (clips(parent)) {
        clippedBy = parent;
        break;
      }
    }
    // The page itself scrolling is a way out too.
    if (!reachable && !clippedBy) {
      const root = document.documentElement;
      if (root.scrollHeight - root.clientHeight > 4) reachable = true;
    }
    if (!reachable) {
      found.push({
        element: name(el),
        box: Math.round(el.clientHeight),
        content: Math.round(el.scrollHeight),
        lost: Math.round(overflow),
        clippedBy: clippedBy ? name(clippedBy) : 'nothing scrolls, the page included',
      });
    }
  }
  return found;
};
