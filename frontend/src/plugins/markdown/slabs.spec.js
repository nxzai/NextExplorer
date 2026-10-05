import { describe, expect, it } from 'vitest';
import { marked } from 'marked';

import { FENCE_REACH_BYTES, PARAGRAPH_REACH_FACTOR, nextSlabEnd, slabSource } from './slabs';

/**
 * Where the preview cuts a document. A cut at a blank line is invisible on the
 * page; everything else here is a compromise made so that no slab — and no
 * single element the browser has to lay out — is the size of the document.
 */

/** Every slab of a document, cut the way the preview cuts it. */
const slabsOf = (text, target) => {
  const slabs = [];
  let index = 0;
  let openFence = null;
  while (index < text.length) {
    const cut = nextSlabEnd(text, index, target, openFence);
    expect(cut.end).toBeGreaterThan(index);
    slabs.push({
      from: index,
      end: cut.end,
      source: slabSource(text, index, cut.end, openFence, cut.fence),
    });
    openFence = cut.fence;
    index = cut.end;
  }
  return slabs;
};

describe('a slab', () => {
  it('ends at a blank line once it has reached its size', () => {
    const text = `${'a'.repeat(50)}\n\n${'b'.repeat(50)}\n\n${'c'.repeat(50)}`;

    expect(nextSlabEnd(text, 0, 40)).toEqual({ end: 52, fence: null });
  });

  /**
   * The document that froze the preview: short lines, and never a blank one.
   * The cut is the first line end past the size, not the last one in reach:
   * the size is what the renderer adapts from one slab to the next.
   */
  it('ends at the first line end past its size when no blank line comes in reach', () => {
    // Ten characters a line, so the thousandth character ends one.
    const lines = Array.from({ length: 2000 }, (unused, i) => `line ${String(i).padStart(4)}`);
    const text = lines.join('\n');

    expect(nextSlabEnd(text, 0, 1000)).toEqual({ end: 1000, fence: null });
  });

  /**
   * A code block that fits in a slab of its own is never split: the slab
   * before it ends where it can, and the block starts the next one whole.
   */
  it('ends before a code block that would carry it too far, rather than inside it', () => {
    const prose = 'a line of prose\n'.repeat(8000);
    const code = 'const value = 1;\n'.repeat(Math.floor((FENCE_REACH_BYTES * 0.9) / 17));
    const text = `${prose}\`\`\`js\n${code}\`\`\`\n\nAfter the code.`;

    const slabs = slabsOf(text, 64 * 1024);
    const html = slabs.map(({ source }) => marked.parser(marked.lexer(source))).join('');

    expect(slabs.some(({ source }) => source.startsWith('```js\n'))).toBe(true);
    expect(html.match(/<pre>/g)).toHaveLength(1);
    expect(html).toMatch(/<p>After the code.<\/p>/);
  });

  it('still prefers a blank line that comes within reach', () => {
    const text = `${'x'.repeat(30)}\n${'y'.repeat(30)}\n\n${'z'.repeat(200)}`;

    expect(nextSlabEnd(text, 0, 40).end).toBe(63);
  });

  /**
   * Far larger than the slab it starts in, and still one block: the slab ends
   * before it, and the block is the next slab, whole.
   */
  it('never cuts an ordinary code block, blank lines or not', () => {
    const code = Array.from({ length: 300 }, (unused, i) =>
      i % 7 === 0 ? '' : `const x${i} = ${i};`
    ).join('\n');
    const text = `intro\n\n\`\`\`js\n${code}\n\`\`\`\n\nafter`;

    const slabs = slabsOf(text, 64);
    const withCode = slabs.filter(({ source }) => source.includes('const x'));
    const html = slabs.map(({ source }) => marked.parser(marked.lexer(source))).join('');

    expect(withCode).toHaveLength(1);
    expect(withCode[0].source.startsWith('```js\n')).toBe(true);
    expect(
      slabs.every(({ source }) => !source.endsWith('```\n') || source.includes('const x'))
    ).toBe(true);
    expect(html.match(/<pre>/g)).toHaveLength(1);
    expect(html).toContain('const x1 = 1;');
    expect(html).toContain('const x299 = 299;');
  });

  it('cuts a line longer than a slab at a space', () => {
    const text = 'word '.repeat(1000);

    const { end } = nextSlabEnd(text, 0, 100);

    expect(end).toBeLessThanOrEqual(100 * PARAGRAPH_REACH_FACTOR);
    expect(text[end - 1]).toBe(' ');
  });

  it('cuts a line with no space in reach at its reach, never inside a character', () => {
    // Two code units each, starting one unit in: the reach falls inside one.
    const text = `a${'😀'.repeat(200)}`;
    const reach = 45 * PARAGRAPH_REACH_FACTOR;
    const halfOfOne = (at) => text.charCodeAt(at) >= 0xd800 && text.charCodeAt(at) <= 0xdbff;
    expect(halfOfOne(reach - 1)).toBe(true);

    const { end } = nextSlabEnd(text, 0, 45);

    expect(end).toBeLessThanOrEqual(reach);
    expect(halfOfOne(end - 1)).toBe(false);
  });
});

describe('a whole document cut into slabs', () => {
  const kinds = {
    'paragraphs and blank lines': Array.from(
      { length: 400 },
      (unused, i) => `Paragraph ${i}.`
    ).join('\n\n'),
    'lines and no blank line': Array.from(
      { length: 4000 },
      (unused, i) => `Line ${i} of text`
    ).join('\n'),
    'one enormous line': 'lorem ipsum dolor sit amet '.repeat(4000),
  };

  for (const [kind, text] of Object.entries(kinds)) {
    it(`gives back every character of ${kind}, in order`, () => {
      const slabs = slabsOf(text, 512);

      expect(slabs.map(({ from, end }) => text.slice(from, end)).join('')).toBe(text);
      expect(slabs.length).toBeGreaterThan(1);
      for (const { from, end } of slabs) {
        expect(end - from).toBeLessThanOrEqual(512 * PARAGRAPH_REACH_FACTOR);
      }
    });
  }

  /**
   * A code block larger than any slab is cut too, or it is one slab after all.
   * It is closed where it is cut and reopened with its own fence, so the text
   * after it is not read as code.
   */
  it('splits a code block far larger than a slab, and keeps what follows out of it', () => {
    const lines = Math.ceil(FENCE_REACH_BYTES / 20) + 500;
    const code = Array.from({ length: lines }, (unused, i) => `const v${i} = ${i};`).join('\n');
    const text = `\`\`\`js\n${code}\n\`\`\`\n\nThe text after the code.`;

    const slabs = slabsOf(text, 64 * 1024);
    const html = slabs.map(({ source }) => marked.parser(marked.lexer(source))).join('');

    expect(slabs.length).toBeGreaterThan(1);
    expect(slabs[0].source.startsWith('```js\n')).toBe(true);
    expect(slabs[1].source.startsWith('```js\n')).toBe(true);
    expect(html).toContain('const v0 = 0;');
    expect(html).toContain(`const v${lines - 1} = ${lines - 1};`);
    expect(html).toMatch(/<p>The text after the code.<\/p>/);
    expect(html).not.toMatch(/<code[^>]*>[^<]*The text after the code/);
  });
});
