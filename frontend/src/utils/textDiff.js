/**
 * What two — or three — texts have in common, and where they part.
 *
 * Written here rather than taken from a library for the reason this fork writes
 * most things: the answer has to be *aligned*, not merely listed. A patch tells you
 * what changed; a comparison has to put line 40 of one file beside the line it
 * corresponds to in the other, with a gap where there is nothing to put, because
 * that is what the reader reads and what a copy across acts on. Diff libraries
 * answer the first question and leave the second to their caller.
 *
 * Line-based, which is what a text comparison means to somebody comparing two
 * configuration files. Within a changed pair the words that differ are marked too,
 * because "this line changed" is not much help on a line of two hundred characters.
 */

/**
 * The lines of a text, and how its lines end.
 *
 * Kept, because a comparison that saves a file back must not rewrite every line
 * ending in it: a CRLF file edited by a copy across and saved with newlines is a
 * file where every line differs from what it was, and whoever reviews that change
 * will not thank anybody. The dominant ending wins, which is what an editor does.
 */
export const readLines = (text) => {
  const source = String(text ?? '');
  const crlf = (source.match(/\r\n/g) || []).length;
  const cr = (source.match(/\r(?!\n)/g) || []).length;
  const lf = (source.match(/(?<!\r)\n/g) || []).length;
  // Whichever it mostly uses, and a newline when it says nothing at all: a text of
  // one line has no ending to read, and guessing CRLF there would add one.
  const newline = crlf > lf && crlf >= cr ? '\r\n' : cr > lf && cr > crlf ? '\r' : '\n';
  return { lines: source.split(/\r\n|\r|\n/), newline };
};

/** The text of those lines again, ended the way the file ends its lines. */
export const writeLines = (lines, newline = '\n') => (lines || []).join(newline);

/**
 * How much work the alignment will do before it gives up on being precise.
 *
 * Myers' algorithm costs O((n+m)·d) where d is the number of differences, which is
 * fast for two versions of the same file and slow for two unrelated ones. Past this
 * the two texts have nothing much in common, and saying so — one block replaced by
 * another — is both the truth and the only answer anybody would read.
 */
const MAX_EDIT_DISTANCE = 4000;

/**
 * The shortest edit script between two arrays, as a list of moves.
 *
 * Myers' greedy algorithm: walk the diagonals, keep the furthest point reached on
 * each, and stop when one of them reaches the far corner. The trace of every step
 * is kept so the path can be walked backwards, which is what turns "how many
 * differences" into "which lines pair with which".
 *
 * Answers null when the two are too far apart to be worth pairing line by line.
 */
const editScript = (a, b) => {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDIT_DISTANCE);
  const offset = max;
  const trace = [];
  let v = new Int32Array(2 * max + 2);

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      // Down when the diagonal above got further, right otherwise: the choice is
      // what makes this greedy, and it is why the trace is needed to recover the
      // path afterwards.
      const goDown = k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset]);
      let x = goDown ? v[k + 1 + offset] : v[k - 1 + offset] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) return { trace, offset, distance: d };
    }
    v = v.slice();
  }

  return null;
};

/** The path back through the trace, as pairs: [-1, j] added, [i, -1] removed. */
const walkBack = (a, b, { trace, offset, distance }) => {
  const moves = [];
  let x = a.length;
  let y = b.length;

  for (let d = distance; d > 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const goDown = k === -d || (k !== d && v[k - 1 + offset] < v[k + 1 + offset]);
    const prevK = goDown ? k + 1 : k - 1;
    const prevX = v[prevK + offset];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      moves.push([x, y]);
    }
    if (goDown) {
      y -= 1;
      moves.push([-1, y]);
    } else {
      x -= 1;
      moves.push([x, -1]);
    }
  }

  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    moves.push([x, y]);
  }

  return moves.reverse();
};

/**
 * The two texts, line by line, side by side.
 *
 * Every row carries the index each side contributes, or null where that side has
 * nothing to put there — which is the gap the reader sees and the thing a copy
 * across fills or empties. Runs of "gone from the left" and "new on the right" that
 * meet are paired into changed rows instead of being stacked as a removal followed
 * by an addition: two versions of one line belong on one row, and that is also the
 * only shape in which "copy this line across" means anything.
 */
export const alignLines = (leftLines, rightLines) => {
  const a = leftLines || [];
  const b = rightLines || [];
  const script = editScript(a, b);

  if (!script) {
    // Too far apart to pair: one block for one block, which is the truth.
    return pairRuns(
      a.map((_, index) => ({ left: index, right: null })),
      b.map((_, index) => ({ left: null, right: index }))
    );
  }

  const rows = [];
  let removed = [];
  let added = [];

  const flush = () => {
    if (removed.length || added.length) rows.push(...pairRuns(removed, added));
    removed = [];
    added = [];
  };

  for (const [i, j] of walkBack(a, b, script)) {
    if (i >= 0 && j >= 0) {
      flush();
      rows.push({ kind: 'same', left: i, right: j });
      continue;
    }
    if (i >= 0) removed.push({ left: i, right: null });
    else added.push({ left: null, right: j });
  }
  flush();

  return rows;
};

/** A run gone from one side beside a run new on the other, paired as far as both go. */
const pairRuns = (removed, added) => {
  const rows = [];
  const shared = Math.min(removed.length, added.length);
  for (let index = 0; index < shared; index += 1) {
    rows.push({ kind: 'changed', left: removed[index].left, right: added[index].right });
  }
  for (let index = shared; index < removed.length; index += 1) {
    rows.push({ kind: 'removed', left: removed[index].left, right: null });
  }
  for (let index = shared; index < added.length; index += 1) {
    rows.push({ kind: 'added', left: null, right: added[index].right });
  }
  return rows;
};

/**
 * The differences, as blocks rather than rows.
 *
 * What the reader steps through, and what a copy across acts on: a run of eleven
 * changed lines is one difference, not eleven, and "next difference" that stopped
 * eleven times would be a button nobody presses twice.
 */
export const blocksOf = (rows) => {
  const blocks = [];
  let current = null;

  (rows || []).forEach((row, index) => {
    if (row.kind === 'same') {
      current = null;
      return;
    }
    if (!current) {
      current = { from: index, to: index };
      blocks.push(current);
      return;
    }
    current.to = index;
  });

  return blocks;
};

/**
 * Three texts, aligned on the middle one.
 *
 * The middle is the anchor because that is what three-way comparison is *for*: two
 * people changed a common version, and what the reader needs to see is what each of
 * them did to it. Aligning left to middle and right to middle and then merging on
 * the middle's own lines gives every row up to three cells and, with them, the one
 * answer a two-way comparison cannot give — whether the two changes are the same
 * change, different changes, or a change on one side only.
 */
export const alignThree = (leftLines, middleLines, rightLines) => {
  const leftRows = alignLines(middleLines || [], leftLines || []);
  const rightRows = alignLines(middleLines || [], rightLines || []);

  // What each side put against each line of the middle, and what it put between
  // them: a line that is only on one side belongs after the middle line above it.
  const against = (rows) => {
    const paired = new Map();
    const before = new Map();
    let lastMiddle = -1;
    for (const row of rows) {
      if (row.left !== null) {
        paired.set(row.left, row.right);
        lastMiddle = row.left;
        continue;
      }
      if (!before.has(lastMiddle + 1)) before.set(lastMiddle + 1, []);
      before.get(lastMiddle + 1).push(row.right);
    }
    return { paired, before };
  };

  const left = against(leftRows);
  const right = against(rightRows);
  const rows = [];

  const extras = (index) => {
    const own = [...(left.before.get(index) || [])];
    const theirs = [...(right.before.get(index) || [])];
    while (own.length || theirs.length) {
      rows.push({
        kind: 'changed',
        left: own.length ? own.shift() : null,
        middle: null,
        right: theirs.length ? theirs.shift() : null,
      });
    }
  };

  const middle = middleLines || [];
  for (let index = 0; index < middle.length; index += 1) {
    extras(index);
    const onLeft = left.paired.has(index) ? left.paired.get(index) : null;
    const onRight = right.paired.has(index) ? right.paired.get(index) : null;
    const leftSame = onLeft !== null && (leftLines || [])[onLeft] === middle[index];
    const rightSame = onRight !== null && (rightLines || [])[onRight] === middle[index];
    rows.push({
      kind: leftSame && rightSame ? 'same' : 'changed',
      left: onLeft,
      middle: index,
      right: onRight,
    });
  }
  extras(middle.length);

  return rows;
};

/**
 * Within a changed pair, the part that actually differs.
 *
 * saying only that a line changed is not much help on a line of two hundred characters, and a
 * word-by-word comparison of every changed line in a large file costs more than it
 * returns. What earns its place is the cheap half of the answer: trim what the two
 * lines begin and end with, and what is left in the middle is what changed. On a
 * one-character difference in a long path that is the difference, highlighted
 * exactly.
 *
 * Answers null when one line is entirely contained in the other at both ends — a
 * line that only grew, where marking "the middle" would mark nothing useful — and
 * for two lines with nothing in common, where the whole line is the answer.
 */
export const inlineSpans = (leftLine, rightLine) => {
  const a = String(leftLine ?? '');
  const b = String(rightLine ?? '');
  if (a === b) return null;

  let start = 0;
  const shortest = Math.min(a.length, b.length);
  while (start < shortest && a[start] === b[start]) start += 1;

  let end = 0;
  while (end < shortest - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1;

  return {
    left: { from: start, to: a.length - end },
    right: { from: start, to: b.length - end },
  };
};
