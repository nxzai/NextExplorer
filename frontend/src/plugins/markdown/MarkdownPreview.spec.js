import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

import MarkdownPreview from './MarkdownPreview.vue';
import { useFeaturesStore } from '@/stores/features';

/**
 * Rendering happens on the one thread the interface has: marked walks the whole
 * document, DOMPurify walks the HTML it produced, and the browser lays out
 * every node. A few megabytes of that is minutes during which nothing else in
 * the application responds — and the result is a page nobody scrolls.
 *
 * The refusal has to explain itself. Someone who raised EDITOR_MAX_FILESIZE to
 * 10 MB and was then refused a 6.5 MB document had no way of knowing that the
 * preview answers to a different setting over different work — the number that
 * stopped them appeared in no setting and no document.
 */

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  messages: {
    en: {
      preview: {
        tooLargeToRenderSized: 'This document is {size}. The preview stops at {limit}.',
        tooLargeToRenderWithEditor:
          'This document is {size}. The preview stops at {limit}; the editor opens up to {editorLimit}.',
        stillRendering: 'Rendering… {percent}%',
      },
    },
  },
});

const mountWith = (content) =>
  mount(MarkdownPreview, {
    props: {
      item: { name: 'notes.md' },
      extension: 'md',
      filePath: 'Docs/notes.md',
      previewUrl: '/preview',
      api: { fetchContent: vi.fn().mockResolvedValue({ content }) },
    },
    global: { plugins: [i18n] },
  });

/**
 * Frames are driven here rather than waited for. jsdom's own
 * `requestAnimationFrame` costs sixteen milliseconds a turn, and a document
 * rendered over hundreds of turns then takes longer to test than to read.
 * Holding the callbacks also makes "one chunk has arrived, the rest has not"
 * something a test can state exactly.
 */
let frameCallbacks = [];

const settle = async () => {
  // The component imports its renderer on demand; that has to land first.
  await vi.dynamicImportSettled();
  await flushPromises();
};

/** Run the frames that are waiting, and whatever they queue behind them. */
const runFrames = async (limit = Infinity) => {
  let turns = 0;
  while (frameCallbacks.length > 0 && turns < limit) {
    const due = frameCallbacks;
    frameCallbacks = [];
    for (const callback of due) callback();
    await flushPromises();
    turns += 1;
  }
  return turns;
};

const settleFully = async () => {
  await settle();
  await runFrames();
};

beforeEach(() => {
  setActivePinia(createPinia());
  frameCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (callback) => frameCallbacks.push(callback));
});

describe('previewing a markdown document', () => {
  it('renders one of an ordinary size', async () => {
    const wrapper = mountWith('# Title\n\nSome **bold** text.');
    await settleFully();

    expect(wrapper.html()).toContain('<h1');
    expect(wrapper.text()).not.toContain('preview stops');
  });

  /**
   * The reason this is not virtualised. Someone reading a long document
   * presses Ctrl+F and expects the browser to cross all of it, which it can
   * only do over text that is really in the page — so the end of a large
   * document has to be there, not merely reachable by scrolling to it.
   */
  it('puts the whole document in the page, end included', async () => {
    // Comfortably past one slab, so there really is more than one.
    const body = Array.from(
      { length: 2000 },
      (unused, index) => `Paragraph ${index}. ${'Some ordinary sentence of prose. '.repeat(3)}`
    ).join('\n\n');
    const wrapper = mountWith(`# Title\n\n${body}\n\nPangolinAtTheVeryEnd`);
    await settleFully();

    expect(wrapper.text()).toContain('Paragraph 0.');
    expect(wrapper.text()).toContain('Paragraph 1999.');
    expect(wrapper.text()).toContain('PangolinAtTheVeryEnd');
  });

  // Rendering the whole thing in one stretch is what froze the tab. It has to
  // arrive in pieces, with the browser given back in between.
  it('arrives in pieces rather than all at once', async () => {
    // Comfortably past one slab, so there really is more than one.
    const body = Array.from(
      { length: 2000 },
      (unused, index) => `Paragraph ${index}. ${'Some ordinary sentence of prose. '.repeat(3)}`
    ).join('\n\n');
    const wrapper = mountWith(`# Title\n\n${body}`);

    await settle();
    const afterFirstChunk = wrapper.text();
    const turns = await runFrames();
    const whenFinished = wrapper.text();

    // Something is on screen straight away...
    expect(afterFirstChunk).toContain('Paragraph 0.');
    // ...it was not everything, and the browser was handed back in between.
    expect(afterFirstChunk.length).toBeLessThan(whenFinished.length);
    expect(turns).toBeGreaterThan(0);
    expect(whenFinished).toContain('Paragraph 1999.');
  });

  // Chunks the reader has not reached are skipped by the browser for layout
  // and paint, which is what keeps a long document scrolling smoothly — and,
  // unlike hiding them, leaves their text findable.
  it('marks its chunks so the browser can skip what is off screen', async () => {
    const wrapper = mountWith('# Title\n\nSome text.');
    await settleFully();

    const section = wrapper.element.querySelector('section');
    expect(section).toBeTruthy();
    expect(section.style.contentVisibility).toBe('auto');
    expect(section.style.containIntrinsicSize).toContain('auto');
  });

  // A constant placeholder makes the scrollbar lurch every time a chunk is
  // measured for real, because slabs grow as the document is read.
  it('estimates each chunk from the source it came from', async () => {
    const short = mountWith('# Title\n\nShort.');
    await settleFully();
    const shortEstimate = short.element.querySelector('section').style.containIntrinsicSize;

    const long = mountWith(
      Array.from({ length: 400 }, (unused, i) => `Paragraph ${i}. ${'Prose. '.repeat(10)}`).join(
        '\n\n'
      )
    );
    await settleFully();
    const longEstimate = long.element.querySelector('section').style.containIntrinsicSize;

    const pixels = (value) => Number.parseInt(String(value).replace(/\D+/g, ''), 10);
    expect(pixels(longEstimate)).toBeGreaterThan(pixels(shortEstimate));
  });

  it('refuses what the server said is beyond the preview', async () => {
    const store = useFeaturesStore();
    store.previewMaxRenderBytes = 1024;
    store.editorMaxFileSizeBytes = null;

    const wrapper = mountWith('x'.repeat(4096));
    await settle();

    expect(wrapper.text()).toContain('4 KB');
    expect(wrapper.text()).toContain('1 KB');
    expect(wrapper.html()).not.toContain('<h1');
  });

  // The whole point: the two limits are different settings over different
  // work, and someone who set one of them is owed that sentence here.
  it('names the editor limit too, so the two are not confused', async () => {
    const store = useFeaturesStore();
    store.previewMaxRenderBytes = 1024;
    store.editorMaxFileSizeBytes = 10 * 1024 * 1024;

    const wrapper = mountWith('x'.repeat(4096));
    await settle();

    expect(wrapper.text()).toContain('editor opens up to 10 MB');
  });

  // A reader who closes the preview should not leave it rendering behind them.
  it('stops rendering when the preview is closed', async () => {
    // Comfortably past one slab, so there really is more than one.
    const body = Array.from(
      { length: 2000 },
      (unused, index) => `Paragraph ${index}. ${'Some ordinary sentence of prose. '.repeat(3)}`
    ).join('\n\n');
    const wrapper = mountWith(`# Title\n\n${body}`);
    await settle();

    const pendingBefore = frameCallbacks.length;
    wrapper.unmount();
    const turns = await runFrames();

    // It had more to do, and it stopped: the frames it had already asked for
    // ran, and none of them queued another.
    expect(pendingBefore).toBeGreaterThan(0);
    expect(turns).toBe(1);
  });
});

/**
 * Reading the document in slabs is what removed the freeze, and it introduces
 * two ways to get it wrong that a rendered page shows immediately.
 */
describe('reading the document in slabs', () => {
  it('never cuts inside a fenced code block', async () => {
    // Filler either side, so the fence lands well past a slab boundary.
    const filler = Array.from(
      { length: 2000 },
      (unused, i) => `Line ${i}. ${'Some ordinary sentence of prose. '.repeat(3)}`
    ).join('\n\n');
    // Blank lines *inside* the block are the whole point: a split only ever
    // happens at one, so a code block without any is never at risk and proves
    // nothing about the guard.
    const code = Array.from({ length: 4000 }, (unused, i) =>
      i % 5 === 0 ? '' : `const x${i} = ${i};`
    );
    const fenced = ['```js', ...code, '```'].join('\n');
    const wrapper = mountWith(`${filler}\n\n${fenced}\n\n${filler}`);
    await settleFully();

    // One fence in, one fence out: a slab cut inside it would leave the rest
    // of the document inside a second, unclosed code block.
    const codeBlocks = wrapper.element.querySelectorAll('pre code');
    expect(codeBlocks.length).toBe(1);
    expect(codeBlocks[0].textContent).toContain('const x1 = 1;');
    expect(codeBlocks[0].textContent).toContain('const x3999 = 3999;');
  });

  /**
   * A document that never leaves a blank line — a log pasted into a `.md` — was
   * one slab: a single paragraph the size of the file, lexed, sanitised and
   * laid out in one stretch, which froze the tab for as long as that took.
   */
  it('cuts a document that never leaves a blank line into pieces, and loses none of it', async () => {
    const lines = Array.from({ length: 6000 }, (unused, i) => `Log line ${i} of the export.`);
    const wrapper = mountWith(lines.join('\n'));
    await settleFully();

    expect(wrapper.element.querySelectorAll('section').length).toBeGreaterThan(1);
    expect(wrapper.text()).toContain('Log line 0 of the export.');
    expect(wrapper.text()).toContain('Log line 5999 of the export.');
  });

  // The lexer collects link definitions onto the tokens it produced, so a slab
  // only knows the ones inside it. A definition at the bottom of a long
  // document has to reach a reference at the top.
  it('resolves a reference whose definition is far below it', async () => {
    // Past one slab, or the definition sits in the same slab as the reference
    // and the propagation this checks is never exercised.
    const filler = Array.from(
      { length: 2000 },
      (unused, i) => `Line ${i}. ${'Some ordinary sentence of prose. '.repeat(3)}`
    ).join('\n\n');
    const wrapper = mountWith(
      `See [the manual][guide].\n\n${filler}\n\n[guide]: https://example.com/manual\n`
    );
    await settleFully();

    const link = wrapper.element.querySelector('a[href="https://example.com/manual"]');
    expect(link).toBeTruthy();
    expect(link.textContent).toBe('the manual');
  });
});

/**
 * Handing the browser back costs a frame whether five milliseconds went into
 * the slab or twelve. One yield per slab over a large document is seconds of
 * waiting that no amount of faster rendering removes, so the yield belongs to
 * the budget rather than to the slab.
 */
describe('how often it hands the browser back', () => {
  const manyKilobytes = Array.from(
    { length: 4000 },
    (unused, index) => `Paragraph ${index}. ${'Some ordinary sentence of prose. '.repeat(3)}`
  ).join('\n\n');

  it('does not yield between slabs that fit inside one frame', async () => {
    // A clock that never advances: the budget is never spent, so nothing is
    // owed to the browser however many slabs the document is cut into.
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

    const wrapper = mountWith(manyKilobytes);
    await settle();

    expect(frameCallbacks.length).toBe(0);
    expect(wrapper.text()).toContain('Paragraph 3999.');
  });

  it('yields once the budget is spent', async () => {
    // Every reading is a frame later, so the budget is spent on every slab.
    let clock = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      clock += 20;
      return clock;
    });

    const wrapper = mountWith(manyKilobytes);
    await settle();

    expect(frameCallbacks.length).toBeGreaterThan(0);
    await runFrames();
    expect(wrapper.text()).toContain('Paragraph 3999.');
  });
});
