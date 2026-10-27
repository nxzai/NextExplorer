import { describe, expect, it } from 'vitest';
import { documentItemFromAddress, documentRoute } from './documentRoute';

/**
 * The address a document is opened at.
 *
 * This one is worth more care than a route helper usually is: its result is
 * handed to `window.open`, so a file name that escapes the encoding does not
 * produce a broken link — it produces a second tab on somewhere else. Every
 * case below is a name somebody can create, because a file name is whatever
 * the person who uploaded it typed.
 */
describe('the address of a document', () => {
  it('keeps the slashes between segments and encodes what is inside them', () => {
    expect(documentRoute('Docs/Reports/Q3 plan.docx')).toEqual({
      path: '/open/Docs/Reports/Q3%20plan.docx',
    });
  });

  it('encodes the characters that would otherwise change the address', () => {
    expect(documentRoute('Notes/a b#c?d.png')).toEqual({ path: '/open/Notes/a%20b%23c%3Fd.png' });
    expect(documentRoute('Notes/100%.txt')).toEqual({ path: '/open/Notes/100%25.txt' });
    expect(documentRoute('Notes/a&b=c.txt')).toEqual({ path: '/open/Notes/a%26b%3Dc.txt' });
  });

  it('cannot be talked into an address somewhere else', () => {
    // A scheme in a file name stays a file name: the path it builds always
    // begins with `/open/`, so nothing here can become a destination.
    for (const name of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://evil.example/steal',
      '//evil.example/steal',
      '\\\\evil.example\\steal',
    ]) {
      const { path } = documentRoute(`Notes/${name}`);
      expect(path.startsWith('/open/Notes/'), `${name} left the folder`).toBe(true);
      expect(path).not.toContain('//evil');
      expect(path.toLowerCase()).not.toContain('javascript:');
      expect(path.toLowerCase()).not.toContain('data:');
    }
  });

  it('drops the empty segments a doubled or leading slash leaves behind', () => {
    expect(documentRoute('//Notes//deep///file.txt')).toEqual({
      path: '/open/Notes/deep/file.txt',
    });
  });

  it('answers with the listing rather than an address for nothing at all', () => {
    for (const nothing of ['', '/', null, undefined]) {
      expect(documentRoute(nothing)).toEqual({ path: '/browse/' });
    }
  });
});

/**
 * And the other direction, for anything that has only the address.
 *
 * The document page works out what its address names from its own route
 * parameters. Preparing a tab the reader is *not* on has only the address, and two
 * places working out what it means is two places that will disagree.
 */
describe('a document address, as the entry it names', () => {
  it('is the last segment, in the folder above it', () => {
    expect(documentItemFromAddress('/open/Docs/2026/report.docx')).toEqual({
      name: 'report.docx',
      path: 'Docs/2026',
    });
  });

  it('is a file at the top of a volume, with no folder above it', () => {
    expect(documentItemFromAddress('/open/report.docx')).toEqual({
      name: 'report.docx',
      path: '',
    });
  });

  /** Written as the reader writes it, not as the address encodes it. */
  it('is decoded, segment by segment', () => {
    expect(documentItemFromAddress('/open/Docs/data%20set/a%20report.docx')).toEqual({
      name: 'a report.docx',
      path: 'Docs/data set',
    });
  });

  it('survives a percent sign that decodes to nothing', () => {
    expect(documentItemFromAddress('/open/Docs/100%.txt')).toEqual({
      name: '100%.txt',
      path: 'Docs',
    });
  });

  it('ignores what a query or a fragment adds', () => {
    expect(documentItemFromAddress('/open/Docs/report.docx?from=search#page=2')).toEqual({
      name: 'report.docx',
      path: 'Docs',
    });
  });

  it.each(['/open/', '/open', '/browse/Docs', '', null, undefined])(
    'is nothing for %s, which names no document',
    (address) => {
      expect(documentItemFromAddress(address)).toBeNull();
    }
  );
});
