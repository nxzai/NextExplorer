import { describe, expect, it } from 'vitest';

/**
 * The terminal is loaded when the first one is asked for, rather than by every
 * page, because it carries xterm with it — 289 kB for something most sessions
 * never open and only an administrator can.
 *
 * Asked of the source, not by importing the host: importing it under jsdom pulls
 * xterm in, which reaches for a canvas that is not there, and the test hangs. The
 * host itself was checked in a browser, where it opens and runs a shell; what
 * this guards is the pair of lines that are easy to undo — someone turning the
 * lazy import back into a plain one while tidying the layout, or dropping the
 * condition that keeps the host off the page until there is a terminal in it.
 */

describe('the terminal', () => {
  it('is loaded on demand by the shell of the application, not imported into it', async () => {
    const shell = (await import('@/App.vue?raw')).default;

    expect(shell).toMatch(/defineAsyncComponent\(\s*\(\)\s*=>\s*import\(/);
    expect(shell).not.toMatch(/^import TerminalHost from/m);
  });

  /**
   * And not drawn at all until there is one to draw. An async component loads
   * its chunk when it is first rendered, so a host rendered on every page for
   * every administrator would be xterm on every page for every administrator —
   * which is the cost this was meant to avoid.
   */
  it('is not on the page until a terminal is open', async () => {
    const shell = (await import('@/App.vue?raw')).default;

    expect(shell).toMatch(/<TerminalHost\s+v-if="[^"]*terminalStore\.openIds\.length > 0"/);
  });

  it('is where xterm lives, so it travels with whatever shows a terminal', async () => {
    const surface = (await import('./TerminalSurface.vue?raw')).default;

    expect(surface).toMatch(/@xterm\/xterm/);
  });

  it('is reached from the host, which is chrome around a terminal rather than one', async () => {
    const host = (await import('./TerminalHost.vue?raw')).default;

    expect(host).toMatch(/TerminalSurface/);
    expect(host).not.toMatch(/@xterm\/xterm/);
  });

  /**
   * The page behind a terminal tab draws no terminal at all — the host draws
   * that one too, which is how a shell survives its tab going behind another —
   * so the router has nothing heavy to load and says so.
   */
  it('is not reached from the terminal page, which only claims a session', async () => {
    const view = (await import('@/views/TerminalView.vue?raw')).default;

    expect(view).not.toMatch(/TerminalSurface/);
    expect(view).toMatch(/useTerminalStore/);
  });

  /**
   * And the host is above every layout, which is the other half of the page drawing
   * nothing.
   *
   * The two together were a black rectangle once, when the route sat outside the layout
   * the host was in: a page whose whole job is to say "my tab wants a terminal" had
   * nobody to say it to. Putting the route *inside* that layout fixed the rectangle and
   * left a worse fault behind it — `/browse` and `/terminal` are two route records, so
   * crossing between them destroyed the layout and every shell in it. A terminal that
   * is unmounted is a shell that has been killed.
   *
   * So the host is mounted in the shell of the application, where it outlives every
   * page and every layout, and the terminal's address needs no layout at all.
   *
   * Asked of the source, like the rest of this file: importing the router pulls in
   * every screen it names eagerly, which under jsdom reaches for a canvas that is not
   * there and hangs.
   */
  it('is mounted above every layout, so no layout can take a shell with it', async () => {
    const shell = (await import('@/App.vue?raw')).default;
    const layout = (await import('@/layouts/BrowserLayout.vue?raw')).default;
    const router = (await import('@/router/index.js?raw')).default;
    const terminalRoute = router.slice(
      router.indexOf("path: '/terminal/"),
      router.indexOf("import('@/views/TerminalView.vue')")
    );

    expect(shell).toMatch(/<TerminalHost/);
    expect(layout).not.toMatch(/<TerminalHost/);
    expect(terminalRoute).not.toMatch(/component: BrowserLayout/);
  });
});
