import { describe, expect, it } from 'vitest';

import { alignLines, alignThree, blocksOf, inlineSpans, readLines, writeLines } from './textDiff';

/**
 * What two texts have in common, and where they part.
 *
 * The thing worth testing is not "how many lines changed" — a patch answers that —
 * but the *alignment*: which line of one file sits beside which line of the other,
 * and where the gaps are. That is what the reader reads, and it is what a copy
 * across acts on, so a row pairing the wrong two lines is a button that writes the
 * wrong text into somebody's file.
 */

const align = (left, right) => alignLines(left.split('\n'), right.split('\n'));
const shape = (rows) =>
  rows.map(
    (row) =>
      `${row.kind}:${row.left === null ? '-' : row.left}/${row.right === null ? '-' : row.right}`
  );

describe('two texts, line by line', () => {
  it('pairs every line of two texts that are the same', () => {
    expect(shape(align('one\ntwo', 'one\ntwo'))).toEqual(['same:0/0', 'same:1/1']);
  });

  /** One version of a line beside the other, on one row: that is the whole point. */
  it('puts two versions of a line on one row', () => {
    const rows = align('one\ntwo\nthree', 'one\nTWO\nthree');

    expect(shape(rows)).toEqual(['same:0/0', 'changed:1/1', 'same:2/2']);
  });

  it('leaves a gap on the side that has nothing', () => {
    expect(shape(align('one\nthree', 'one\ntwo\nthree'))).toEqual([
      'same:0/0',
      'added:-/1',
      'same:1/2',
    ]);
  });

  it('leaves the gap on the other side when a line has gone', () => {
    // `three` is the third line on the left and the second on the right, which is
    // the whole business: the same line, at two different numbers.
    expect(shape(align('one\ntwo\nthree', 'one\nthree'))).toEqual([
      'same:0/0',
      'removed:1/-',
      'same:2/1',
    ]);
  });

  /**
   * A run gone against a run arrived is a change, not a removal followed by an
   * addition: two versions of three lines belong beside each other, and stacked
   * they would be six rows the reader has to pair up by eye.
   */
  it('pairs a run against a run, as far as both go', () => {
    const rows = align('a\nb\nc\nd\ne', 'a\nB\nC\nD\nE\nF\ne');

    expect(shape(rows)).toEqual([
      'same:0/0',
      'changed:1/1',
      'changed:2/2',
      'changed:3/3',
      'added:-/4',
      'added:-/5',
      'same:4/6',
    ]);
  });

  it('holds the count of lines on each side, whatever the shape', () => {
    const rows = align('a\nb\nc\nd', 'a\nX\nY\nd\ne');

    expect(rows.filter((row) => row.left !== null)).toHaveLength(4);
    expect(rows.filter((row) => row.right !== null)).toHaveLength(5);
  });

  it('compares a text with nothing as every line arriving', () => {
    expect(shape(align('', 'one\ntwo'))).toEqual(['changed:0/0', 'added:-/1']);
  });

  it('finds a line moved, rather than calling the whole file changed', () => {
    const rows = align('a\nb\nc\nd', 'b\nc\nd\na');

    // Whatever it pairs, it must not claim the four lines have nothing in common.
    expect(rows.filter((row) => row.kind === 'same').length).toBeGreaterThanOrEqual(3);
  });

  /**
   * Two texts with nothing in common: too far apart to pair line by line, so one
   * block for one block, which is both the truth and the only answer worth reading.
   */
  it('answers a block for a block when the two are unrelated', () => {
    const left = Array.from({ length: 3000 }, (_, index) => `left ${index}`);
    const right = Array.from({ length: 3000 }, (_, index) => `right ${index}`);

    const rows = alignLines(left, right);

    expect(rows.every((row) => row.kind === 'changed')).toBe(true);
    expect(rows).toHaveLength(3000);
  });

  /** And it answers at all: an alignment that hangs is worse than a coarse one. */
  it('answers quickly for two long unrelated texts', () => {
    const left = Array.from({ length: 6000 }, (_, index) => `left ${index}`);
    const right = Array.from({ length: 6000 }, (_, index) => `right ${index}`);

    const started = Date.now();
    alignLines(left, right);

    expect(Date.now() - started).toBeLessThan(4000);
  });
});

describe('the differences, as blocks', () => {
  /**
   * What the reader steps through: eleven changed lines are one difference, and a
   * "next difference" that stopped eleven times would be a button nobody presses
   * twice.
   */
  it('gathers a run of changed rows into one', () => {
    const rows = align('a\nb\nc\nd\ne', 'a\nB\nC\nD\ne');

    expect(blocksOf(rows)).toEqual([{ from: 1, to: 3 }]);
  });

  it('counts two runs with something the same between them as two', () => {
    const rows = align('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne');

    expect(blocksOf(rows)).toEqual([
      { from: 1, to: 1 },
      { from: 3, to: 3 },
    ]);
  });

  it('is nothing at all for two texts that are the same', () => {
    expect(blocksOf(align('a\nb', 'a\nb'))).toEqual([]);
  });
});

describe('how a text ends its lines', () => {
  /**
   * Kept, because saving a file back must not rewrite every line ending in it: a
   * CRLF file saved with newlines is a file where every line differs from what it
   * was, and nobody reviewing that change will thank anybody for it.
   */
  it('is remembered, and used again', () => {
    const { lines, newline } = readLines('one\r\ntwo\r\nthree');

    expect(lines).toEqual(['one', 'two', 'three']);
    expect(newline).toBe('\r\n');
    expect(writeLines(lines, newline)).toBe('one\r\ntwo\r\nthree');
  });

  it('is the newline for a text that uses newlines', () => {
    expect(readLines('one\ntwo').newline).toBe('\n');
  });

  it('is whichever it mostly uses, for a text that mixes them', () => {
    expect(readLines('one\r\ntwo\r\nthree\nfour').newline).toBe('\r\n');
  });

  it('is the old carriage return for a text that only has those', () => {
    expect(readLines('one\rtwo\rthree').newline).toBe('\r');
  });

  it('is a newline for a text with one line and no ending at all', () => {
    expect(readLines('one').newline).toBe('\n');
    expect(readLines('').lines).toEqual(['']);
  });
});

describe('three texts, aligned on the middle one', () => {
  const three = (left, middle, right) =>
    alignThree(left.split('\n'), middle.split('\n'), right.split('\n'));
  const shape3 = (rows) =>
    rows.map((row) =>
      `${row.kind}:${row.left ?? '-'}/${row.middle ?? '-'}/${row.right ?? '-'}`.replace(
        /null/g,
        '-'
      )
    );

  it('pairs all three where all three agree', () => {
    expect(shape3(three('a\nb', 'a\nb', 'a\nb'))).toEqual(['same:0/0/0', 'same:1/1/1']);
  });

  /** The one answer two-way comparison cannot give: who changed what. */
  it('marks a line one side changed and the other did not', () => {
    const rows = three('a\nCHANGED\nc', 'a\nb\nc', 'a\nb\nc');

    expect(shape3(rows)).toEqual(['same:0/0/0', 'changed:1/1/1', 'same:2/2/2']);
    expect(rows[1].left).not.toBeNull();
    expect(rows[1].right).not.toBeNull();
  });

  it('marks a line both sides changed, each in their own way', () => {
    const rows = three('a\nMINE\nc', 'a\nb\nc', 'a\nTHEIRS\nc');

    expect(rows[1].kind).toBe('changed');
    expect(rows[1].middle).toBe(1);
  });

  it('keeps a line only one side added, with a gap for the others', () => {
    const rows = three('a\nextra\nb', 'a\nb', 'a\nb');

    const added = rows.find((row) => row.middle === null);
    expect(added.left).not.toBeNull();
    expect(added.right).toBeNull();
  });

  it('holds every line of all three sides', () => {
    const rows = three('a\nMINE\nc\nd', 'a\nb\nc', 'a\nb\nTHEIRS\nz');

    expect(rows.filter((row) => row.left !== null)).toHaveLength(4);
    expect(rows.filter((row) => row.middle !== null)).toHaveLength(3);
    expect(rows.filter((row) => row.right !== null)).toHaveLength(4);
  });
});

describe('within a changed pair', () => {
  /**
   * "This line changed" is not much help on a line of two hundred characters. The
   * cheap half of the answer — trim what both lines begin and end with — is exactly
   * right for the case that matters: one character different in a long path.
   */
  it('is the part in the middle that differs', () => {
    const spans = inlineSpans('/etc/nginx/sites/a.conf', '/etc/nginx/sites/b.conf');

    expect('/etc/nginx/sites/a.conf'.slice(spans.left.from, spans.left.to)).toBe('a');
    expect('/etc/nginx/sites/b.conf'.slice(spans.right.from, spans.right.to)).toBe('b');
  });

  it('is what was inserted, when a line only grew', () => {
    const spans = inlineSpans('port = 80', 'port = 8080');

    expect('port = 8080'.slice(spans.right.from, spans.right.to)).toBe('80');
    expect(spans.left.from).toBe(spans.left.to);
  });

  it('is the whole of both lines when they share nothing', () => {
    const spans = inlineSpans('alpha', 'omicron');

    expect(spans.left).toEqual({ from: 0, to: 5 });
    expect(spans.right).toEqual({ from: 0, to: 7 });
  });

  /** Two lines that happen to end alike keep that ending out of the answer. */
  it('trims an ending the two happen to share', () => {
    const spans = inlineSpans('alpha', 'omega');

    expect('alpha'.slice(spans.left.from, spans.left.to)).toBe('alph');
    expect('omega'.slice(spans.right.from, spans.right.to)).toBe('omeg');
  });

  it('is nothing at all for two lines that are the same', () => {
    expect(inlineSpans('same', 'same')).toBeNull();
  });

  it('is the whole of a line against nothing', () => {
    const spans = inlineSpans('', 'added');

    expect(spans.right).toEqual({ from: 0, to: 5 });
  });

  /** The trims must not cross: a repeated character could otherwise be counted twice. */
  it('does not let the two trims overlap', () => {
    const spans = inlineSpans('aaa', 'aaaaa');

    expect(spans.left.to).toBeGreaterThanOrEqual(spans.left.from);
    expect(spans.right.to).toBeGreaterThanOrEqual(spans.right.from);
    expect('aaaaa'.slice(spans.right.from, spans.right.to)).toBe('aa');
  });
});
