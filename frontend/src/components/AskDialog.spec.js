import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

/**
 * Where a question the application asks is drawn.
 *
 * The dialog itself is the application's, shared with every other dialog here, so what
 * is worth holding is only what this one adds: that the question and its two answers
 * reach the screen, that a question asking for something is a field somebody can type
 * in and that the keyboard is put in it, and that leaving the dialog any other way —
 * the cross, Escape, the background — is a refusal rather than silence.
 */
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key) => key }) }));

let AskDialog;
let useAsk;

beforeEach(async () => {
  vi.resetModules();
  ({ useAsk } = await import('@/composables/useAsk'));
  AskDialog = (await import('./AskDialog.vue')).default;
});

const shown = () => mount(AskDialog, { attachTo: document.body });

describe('a question on screen', () => {
  it('shows nothing while nothing is being asked', () => {
    const wrapper = shown();

    expect(document.body.querySelector('[data-test="ask-confirm"]')).toBe(null);
    wrapper.unmount();
  });

  it('says what is being asked, and in the words it was given', async () => {
    const wrapper = shown();
    const asking = useAsk();

    void asking.ask({ title: 'Unsaved lines', body: 'Close it anyway?', confirmLabel: 'Close' });
    await flushPromises();

    expect(document.body.textContent).toContain('Unsaved lines');
    expect(document.body.textContent).toContain('Close it anyway?');
    expect(document.body.querySelector('[data-test="ask-confirm"]').textContent.trim()).toBe(
      'Close'
    );
    wrapper.unmount();
  });

  it('answers yes from the one button and no from the other', async () => {
    const wrapper = shown();
    const asking = useAsk();

    const yes = asking.ask({ title: 'Close it?' });
    await flushPromises();
    document.body.querySelector('[data-test="ask-confirm"]').click();
    expect(await yes).toBe(true);

    const no = asking.ask({ title: 'Close it?' });
    await flushPromises();
    document.body.querySelector('[data-test="ask-cancel"]').click();
    expect(await no).toBe(false);
    wrapper.unmount();
  });

  /**
   * Shutting the dialog is an answer, not a silence: a question left unanswered leaves
   * whoever asked it holding a gesture that never finishes.
   */
  it('is a refusal when the dialog is shut rather than answered', async () => {
    const wrapper = shown();
    const asking = useAsk();

    const answer = asking.ask({ title: 'Close it?' });
    await flushPromises();
    document.body.querySelector('[aria-label="common.close"]').click();

    expect(await answer).toBe(false);
    wrapper.unmount();
  });
});

describe('a question that asks for something', () => {
  it('offers a field holding what is there, and hands it the keyboard', async () => {
    const wrapper = shown();
    const asking = useAsk();

    void asking.askFor({ title: 'Rename', label: 'A new name', value: 'old name' });
    await flushPromises();

    const field = document.body.querySelector('[data-test="ask-field"]');
    expect(field.value).toBe('old name');
    // Not the cross in the corner, which is what the dialog would otherwise focus:
    // somebody asked to type something should be able to type.
    expect(document.activeElement).toBe(field);
    wrapper.unmount();
  });

  it('answers with what was typed, and on the enter key', async () => {
    const wrapper = shown();
    const asking = useAsk();

    const answer = asking.askFor({ title: 'Rename', value: 'old' });
    await flushPromises();
    const field = document.body.querySelector('[data-test="ask-field"]');
    field.value = 'new';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(await answer).toBe('new');
    wrapper.unmount();
  });

  /** A password is not read over somebody's shoulder. */
  it('hides what is typed when what is asked for is a password', async () => {
    const wrapper = shown();
    const asking = useAsk();

    void asking.askFor({ title: 'New password', password: true });
    await flushPromises();

    expect(document.body.querySelector('[data-test="ask-field"]').type).toBe('password');
    wrapper.unmount();
  });

  it('offers no field for a question that is only yes or no', async () => {
    const wrapper = shown();
    const asking = useAsk();

    void asking.ask({ title: 'Close it?' });
    await flushPromises();

    expect(document.body.querySelector('[data-test="ask-field"]')).toBe(null);
    wrapper.unmount();
  });
});
