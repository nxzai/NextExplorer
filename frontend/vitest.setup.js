import { beforeEach } from 'vitest';

/**
 * Give tests a Web Storage that behaves like a browser's.
 *
 * Node 25 exposes its own `localStorage` global, and it wins over the one jsdom
 * installs — but it is backed by a file Node was never given, so it arrives
 * without the methods the standard defines. Any test that clears storage
 * between cases fails on `localStorage.clear is not a function`, and the
 * failure points at the test rather than at the environment.
 *
 * Replaced only when it is actually broken, so a future Node that provides a
 * working one is left alone.
 */

const createStorage = () => {
  const entries = new Map();

  return {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => (entries.has(String(key)) ? entries.get(String(key)) : null),
    setItem: (key, value) => {
      entries.set(String(key), String(value));
    },
    removeItem: (key) => {
      entries.delete(String(key));
    },
    clear: () => {
      entries.clear();
    },
  };
};

const isUsable = (storage) =>
  Boolean(storage) &&
  typeof storage.clear === 'function' &&
  typeof storage.getItem === 'function' &&
  typeof storage.setItem === 'function';

for (const name of ['localStorage', 'sessionStorage']) {
  if (isUsable(globalThis[name])) continue;

  const storage = createStorage();
  Object.defineProperty(globalThis, name, {
    value: storage,
    writable: true,
    configurable: true,
  });

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      value: storage,
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Start every test file with empty storage.
 *
 * A worker runs several files in one process and the storage is one object, so
 * what a file leaves behind is what the next one starts with. It cost a
 * `fileStore` test that passed on its own and failed in the suite: the tabs it
 * found were another file's, left in `settings:tabs:open`. Cleared here rather
 * than in each spec, because the next spec to touch storage would have to know
 * to do it.
 */
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/**
 * Give tests `CSS.escape`, which jsdom does not implement.
 *
 * Every browser has had it for a decade, so code that builds a selector from a
 * file name uses it without a second thought — and in jsdom that code throws
 * inside a promise, where the failure is swallowed and the test passes having
 * exercised nothing. Follows the CSSOM serialisation algorithm rather than
 * approximating it, so a name a test escapes here is escaped the way the
 * browser would.
 */
if (typeof globalThis.CSS?.escape !== 'function') {
  const escape = (value) => {
    const string = String(value);
    let result = '';

    for (let index = 0; index < string.length; index += 1) {
      const code = string.charCodeAt(index);
      const character = string.charAt(index);

      if (code === 0x0000) {
        result += '�';
        continue;
      }

      if (
        (code >= 0x0001 && code <= 0x001f) ||
        code === 0x007f ||
        (index === 0 && code >= 0x0030 && code <= 0x0039) ||
        (index === 1 && code >= 0x0030 && code <= 0x0039 && string.charCodeAt(0) === 0x002d)
      ) {
        result += `\\${code.toString(16)} `;
        continue;
      }

      if (index === 0 && code === 0x002d && string.length === 1) {
        result += `\\${character}`;
        continue;
      }

      if (
        code >= 0x0080 ||
        code === 0x002d ||
        code === 0x005f ||
        (code >= 0x0030 && code <= 0x0039) ||
        (code >= 0x0041 && code <= 0x005a) ||
        (code >= 0x0061 && code <= 0x007a)
      ) {
        result += character;
        continue;
      }

      result += `\\${character}`;
    }

    return result;
  };

  const css = globalThis.CSS || {};
  css.escape = escape;
  Object.defineProperty(globalThis, 'CSS', { value: css, writable: true, configurable: true });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'CSS', { value: css, writable: true, configurable: true });
  }
}
