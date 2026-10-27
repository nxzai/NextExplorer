import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

import CodeSurface from './CodeSurface.vue';

/**
 * The editor's text area, with CodeMirror really in it.
 *
 * What it owes the editor is small and easy to get subtly wrong: say when the
 * document differs from the one last read or saved, and never turn the whole
 * document into a string until it is saved. The editor it replaced did that on
 * every keystroke, which on a nineteen-megabyte file was the page freezing a
 * little for each character typed.
 */

let wrapper = null;

beforeEach(() => {
  // CodeMirror measures in animation frames; jsdom has no layout to measure.
  vi.stubGlobal('requestAnimationFrame', () => 0);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
});

const open = async (content = 'hello') => {
  wrapper = mount(CodeSurface, { props: { content }, attachTo: document.body });
  await flushPromises();
  return wrapper.vm.view;
};

const typeAt = (view, at, text) => view.dispatch({ changes: { from: at, insert: text } });
const erase = (view, from, to) => view.dispatch({ changes: { from, to } });

describe('the document', () => {
  it('is the content it was given, and the editor is told it is ready', async () => {
    const view = await open('hello');

    expect(view.state.doc.toString()).toBe('hello');
    expect(wrapper.emitted('ready')[0][0].view).toBe(view);
  });

  it('is replaced by a different content, which is then not an unsaved change', async () => {
    const view = await open('first file');

    await wrapper.setProps({ content: 'second file' });

    expect(view.state.doc.toString()).toBe('second file');
    expect(wrapper.emitted('dirty-change')).toBeUndefined();
    expect(wrapper.emitted('edit')).toBeUndefined();
  });
});

describe('unsaved changes', () => {
  it('are reported once something is typed, and each edit is announced', async () => {
    const view = await open('hello');

    typeAt(view, 5, '!');
    typeAt(view, 6, '!');

    expect(wrapper.emitted('dirty-change')).toEqual([[true]]);
    expect(wrapper.emitted('edit')).toHaveLength(2);
  });

  it('are gone again when the text comes back to what was read', async () => {
    const view = await open('hello');

    typeAt(view, 5, '!');
    erase(view, 5, 6);

    expect(wrapper.emitted('dirty-change')).toEqual([[true], [false]]);
  });

  it('are gone once what was typed is saved', async () => {
    const view = await open('hello');
    typeAt(view, 5, ', world');

    wrapper.vm.markSaved(wrapper.vm.snapshot());

    expect(wrapper.emitted('dirty-change')).toEqual([[true], [false]]);
    expect(String(wrapper.vm.snapshot())).toBe('hello, world');
  });

  /** A save takes time, and typing does not stop for it. */
  it('remain for what was typed while the save was being written', async () => {
    const view = await open('hello');
    typeAt(view, 5, ', world');
    const written = wrapper.vm.snapshot();

    typeAt(view, 12, ' and more');
    wrapper.vm.markSaved(written);

    expect(wrapper.emitted('dirty-change')).toEqual([[true]]);
  });

  it('are compared without the document ever becoming a string while typing', async () => {
    const view = await open(Array.from({ length: 2000 }, (unused, i) => `line ${i}`).join('\n'));
    const serialise = vi.fn();
    for (const doc of [view.state.doc, ...(view.state.doc.children || [])]) {
      const prototype = Object.getPrototypeOf(doc);
      const original = prototype.toString;
      if (vi.isMockFunction(original)) continue;
      vi.spyOn(prototype, 'toString').mockImplementation(function toString(...args) {
        serialise();
        return original.apply(this, args);
      });
    }

    for (let i = 0; i < 50; i += 1) typeAt(view, i, 'x');
    for (let i = 0; i < 50; i += 1) erase(view, 0, 1);

    expect(wrapper.emitted('edit')).toHaveLength(100);
    expect(wrapper.emitted('dirty-change')).toEqual([[true], [false]]);
    expect(serialise).not.toHaveBeenCalled();
  });
});

/**
 * Where the reader is, kept and put back.
 *
 * A tab that comes back to a file has to come back to the *place* in it, and a
 * place is a line rather than a number of pixels: the editor draws what is in
 * view and estimates the rest, so its height is a guess that improves as it
 * measures, and a scroll position written into it before it has measured is
 * silently clamped to whatever fits. Somebody who had scrolled halfway down a
 * long file came back to the top of it with their selection sitting beside them,
 * which is how the defect announced itself.
 *
 * jsdom has no layout, so what can be asked here is what does not need one: what
 * is kept, that it is handed back, and that a position no longer in the document
 * cannot throw. Whether the reader ends up looking at the right line is a
 * question for a browser, and `e2e/app/core-flows.spec.js` asks it there.
 */
describe('where the reader is', () => {
  it('is the cursor and the place, and comes back', async () => {
    const view = await open('one\ntwo\nthree\nfour');
    view.dispatch({ selection: { anchor: 4, head: 7 } });
    view.scrollDOM.scrollTop = 120;

    const place = wrapper.vm.place();
    expect(place.selection).toEqual({ anchor: 4, head: 7 });
    expect(place.scrollTop).toBe(120);

    view.dispatch({ selection: { anchor: 0, head: 0 } });
    view.scrollDOM.scrollTop = 0;
    wrapper.vm.restorePlace(place);

    expect(view.state.selection.main.anchor).toBe(4);
    expect(view.state.selection.main.head).toBe(7);
  });

  /**
   * The file may have been written to by somebody else while the tab was away.
   * A cursor past the end of the document throws, and so does a line.
   */
  it('lands inside a file somebody else has shortened', async () => {
    const view = await open('hello');

    expect(() =>
      wrapper.vm.restorePlace({
        selection: { anchor: 900, head: 900 },
        scrollTop: 0,
        topLine: 900,
      })
    ).not.toThrow();

    expect(view.state.selection.main.anchor).toBe(5);
    expect(view.state.selection.main.head).toBe(5);
  });

  it('answers something harmless about a file with nothing in it yet', async () => {
    await open('');

    expect(wrapper.vm.place()).toMatchObject({ scrollTop: 0 });
    expect(() => wrapper.vm.restorePlace(null)).not.toThrow();
  });
});
