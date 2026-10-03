import { computed, ref } from 'vue';

/**
 * A question the application asks in its own voice.
 *
 * `window.confirm` and `window.prompt` were still answering for a dozen of these, and
 * what they put on screen is the browser's box, in the browser's words, headed by the
 * server's address and port — the one thing on screen that does not belong to this
 * application. It also stops everything: a modal browser dialog blocks the event loop,
 * so nothing behind it paints or answers until it is dismissed.
 *
 * So the question is asked the way every other question here is asked — the dialog the
 * application already has — and this holds the one thing the browser gave for free: a
 * call that waits for the answer. The asking is a promise; the screen that asked reads
 * it with `await` and carries on as it did.
 *
 * One at a time, and one instance of it: a question is a thing the window is doing, not
 * a thing a page owns, and a page that asks one is usually on its way out.
 */
let instance = null;

export function useAsk() {
  if (instance) return instance;

  /** What is being asked, or null when nothing is. */
  const question = ref(null);
  /** What has been typed, for a question that asks for something. */
  const answer = ref('');
  let settlePending = null;

  const isOpen = computed(() => question.value !== null);
  const wantsText = computed(() => question.value?.field === true);

  const settle = (value) => {
    if (!settlePending) return;
    const finish = settlePending;
    settlePending = null;
    question.value = null;
    answer.value = '';
    finish(value);
  };

  /**
   * What a refusal is, for the question that is on screen.
   *
   * Two different answers: no is `false`, and nothing typed is `null` — the distinction
   * the browser's `prompt` made and the one every caller reads, because "they typed
   * nothing" and "they called it off" are not the same thing. Read from the question
   * being refused rather than passed in by whoever is refusing it: a second question
   * arriving lends its own shape to nothing.
   */
  const refusal = () => (question.value?.field ? null : false);

  /**
   * A second question replaces the one on screen — and the first is answered as
   * refused rather than left hanging: whoever is waiting on it is holding a gesture
   * that would otherwise never finish.
   */
  const put = (asked) => {
    if (settlePending) settle(refusal());
    question.value = asked;
    answer.value = asked.field ? (asked.value ?? '') : '';
    return new Promise((resolve) => {
      settlePending = resolve;
    });
  };

  /** Yes or no. Resolves true only when it was answered yes. */
  const ask = ({ title = '', body = '', confirmLabel = '', tone = 'normal' } = {}) =>
    put({ title, body, confirmLabel, tone, field: false });

  /**
   * Something to be typed. Resolves with the text, or null when it was called off —
   * which is the distinction `window.prompt` made, and the one callers rely on to tell
   * "nothing" from "no".
   */
  const askFor = ({
    title = '',
    body = '',
    label = '',
    value = '',
    confirmLabel = '',
    password = false,
  } = {}) => put({ title, body, label, value, confirmLabel, password, field: true });

  instance = {
    question,
    answer,
    isOpen,
    wantsText,
    ask,
    askFor,
    cancel: () => settle(refusal()),
    accept: () => settle(question.value?.field ? answer.value : true),
  };
  return instance;
}
