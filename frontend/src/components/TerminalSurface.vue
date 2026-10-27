<template>
  <div ref="terminaldiv" class="h-full w-full"></div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { apiBase, createTerminalSession } from '@/api';
import { useFileStore } from '@/stores/fileStore';
import { useVolumeUsageStore } from '@/stores/volumeUsage';
import { useFolderSizeStore } from '@/stores/folderSize';
import logger from '@/utils/logger';

/**
 * One terminal: the session, the socket, and the folder listing it keeps honest.
 *
 * Everything here used to live inside the drawer that showed it, which meant
 * there could only ever be one. A terminal is a place now — it has an address and
 * a tab of its own — so what a terminal *is* had to come out of what showed it.
 * The drawer still exists and still asks for one of these; so does the page
 * behind a terminal tab, and neither knows anything about the other.
 *
 * Told rather than asking: the path to start in, the first line to type, and
 * whether it should be running at all. Nothing here reads the terminal store, so
 * two of these can be alive at once without a word between them.
 */
const props = defineProps({
  /** The folder the shell starts in. Empty is the home of whoever is signed in. */
  path: { type: String, default: '' },
  /** A first line to type once the shell answers, if the caller wants one. */
  initialInput: { type: String, default: '' },
  /** Whether this terminal should be running. A session that has gone is not. */
  active: { type: Boolean, default: true },
  /**
   * Whether it is on screen.
   *
   * Not the same question as `active`, and the difference is the whole reason a
   * terminal can be left behind a tab: a shell that is not on screen is still
   * running, still connected, still printing. What changes when it comes back is
   * only that it has to be measured again — a terminal measured while its box was
   * hidden came back the wrong size.
   */
  visible: { type: Boolean, default: true },
});

// The stores this terminal keeps honest: a shell that writes a file leaves the
// listing and the sizes on screen out of date, and nothing else will notice.
const fileStore = useFileStore();
const volumeUsageStore = useVolumeUsageStore();
const folderSizeStore = useFolderSizeStore();

const terminaldiv = ref(null);
let term;
let socket;
let fitAddon;
let resizeObserver;
let pendingResize;
let launchInputTimer;
let launchInputSent = false;
let refreshTimer;

// Prefix used to send control messages (like resize) over the same WS channel as raw terminal input.
// This avoids collisions with normal shell input (xterm sends raw keystrokes).
const CONTROL_PREFIX = '\u001e';

const sendInput = (data) => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
};

const normalizeLogicalPath = (value = '') =>
  String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');

const clearRefreshTimer = () => {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
};

const refreshBrowserState = () => {
  const currentPath = normalizeLogicalPath(fileStore.currentPath || '');
  const terminalPath = normalizeLogicalPath(props.path || '');

  if (terminalPath && currentPath === terminalPath) {
    // The listing read again, not navigated to: a shell that wrote a file must
    // not take away whatever the reader had selected beside it.
    fileStore.refresh().catch(() => {});
  }

  volumeUsageStore.scheduleRefresh({ delayMs: 300, force: true });
  folderSizeStore.scheduleRefresh({ delayMs: 300, force: true });
};

const scheduleBrowserRefresh = (delayMs = 900) => {
  clearRefreshTimer();
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshBrowserState();
  }, delayMs);
};

const sendResize = (cols, rows) => {
  const safeCols = Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : null;
  const safeRows = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : null;
  if (!safeCols || !safeRows) return;

  pendingResize = { cols: safeCols, rows: safeRows };

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(
      `${CONTROL_PREFIX}${JSON.stringify({
        type: 'resize',
        cols: safeCols,
        rows: safeRows,
      })}`
    );
  }
};

const clearLaunchInputTimer = () => {
  if (launchInputTimer) {
    clearTimeout(launchInputTimer);
    launchInputTimer = null;
  }
};

const scheduleLaunchInput = () => {
  if (launchInputSent || !props.initialInput) return;

  clearLaunchInputTimer();
  launchInputTimer = setTimeout(() => {
    if (launchInputSent || !props.initialInput) return;
    sendInput(props.initialInput);
    launchInputSent = true;
    launchInputTimer = null;
  }, 150);
};

const focusTerminal = () => {
  requestAnimationFrame(() => {
    term?.focus();
    setTimeout(() => {
      term?.focus();
    }, 50);
  });
};

const toWebSocketScheme = (url) => {
  if (url.startsWith('https://')) {
    return `wss://${url.slice(8)}`;
  }

  if (url.startsWith('http://')) {
    return `ws://${url.slice(7)}`;
  }

  return url;
};

const buildTerminalUrl = (token) => {
  const base = `${apiBase}/api/terminal`;
  const withScheme = toWebSocketScheme(base);
  const url = `${withScheme}?token=${encodeURIComponent(token)}`;
  logger.debug('Terminal WebSocket URL - apiBase', apiBase);
  logger.debug('Terminal WebSocket URL - base', base);
  logger.debug('Terminal WebSocket URL - final', url);
  return url;
};

const connectToBackend = async () => {
  try {
    const session = await createTerminalSession(props.path || '');
    const token = session?.token;
    if (!token) {
      console.error('Failed to obtain terminal session token');
      return;
    }

    const url = buildTerminalUrl(token);
    logger.debug('Attempting to connect to terminal WebSocket', url);
    socket = new WebSocket(url);

    socket.onopen = () => {
      logger.debug('Terminal WebSocket connection opened');
      if (pendingResize) {
        sendResize(pendingResize.cols, pendingResize.rows);
      }
    };

    socket.onmessage = (event) => {
      logger.debug('Received data from terminal', event.data.length, 'bytes');
      if (typeof event.data === 'string' && event.data.startsWith(CONTROL_PREFIX)) {
        try {
          const payload = JSON.parse(event.data.slice(CONTROL_PREFIX.length));
          if (payload?.type === 'filesystemChanged') {
            scheduleBrowserRefresh(500);
          }
        } catch (error) {
          logger.warn('Invalid terminal control message from backend', error);
        }
        return;
      }

      term.write(event.data, scheduleLaunchInput);
    };

    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    socket.onclose = (event) => {
      logger.debug('WebSocket connection closed', event.code, event.reason);
    };
  } catch (error) {
    console.error('Failed to connect to terminal:', error);
  }
};

const initTerminal = () => {
  if (!terminaldiv.value || term) return;

  term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#09090b',
      foreground: '#e4e4e7',
      cursor: '#22d3ee',
      cursorAccent: '#09090b',
      selectionBackground: 'rgba(255, 255, 255, 0.2)',
      selectionForeground: '#ffffff',

      // Normal colors
      black: '#27272a',
      red: '#f87171',
      green: '#4ade80',
      yellow: '#facc15',
      blue: '#60a5fa',
      magenta: '#c084fc',
      cyan: '#22d3ee',
      white: '#e4e4e7',

      // Bright colors
      brightBlack: '#71717a',
      brightRed: '#fca5a5',
      brightGreen: '#86efac',
      brightYellow: '#fde047',
      brightBlue: '#93c5fd',
      brightMagenta: '#d8b4fe',
      brightCyan: '#67e8f9',
      brightWhite: '#fafafa',
    },
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(terminaldiv.value);
  focusTerminal();

  term.onResize(({ cols, rows }) => {
    sendResize(cols, rows);
  });

  resizeObserver = new ResizeObserver(() => {
    // Defer to ensure layout has settled (esp. during panel open/resize).
    requestAnimationFrame(() => {
      fitAddon?.fit();
    });
  });
  resizeObserver.observe(terminaldiv.value);

  // Initial fit (also triggers `onResize` -> sends size to backend).
  requestAnimationFrame(() => {
    fitAddon.fit();
    focusTerminal();
  });

  term.onData((data) => {
    sendInput(data);
    scheduleBrowserRefresh(1800);
  });

  connectToBackend();
};

const teardownTerminal = () => {
  clearLaunchInputTimer();
  clearRefreshTimer();
  launchInputSent = false;

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  if (socket) {
    socket.close();
    socket = null;
  }

  if (term) {
    term.dispose();
    term = null;
  }

  fitAddon = null;
  pendingResize = null;
};

/**
 * Running, or not, as the caller says.
 *
 * The delay is the drawer's: it slides in over a fifth of a second, and a
 * terminal measured while its box is still moving comes out the wrong size.
 */
watch(
  () => props.active,
  (running) => {
    teardownTerminal();
    if (!running) return;
    setTimeout(() => {
      initTerminal();
      if (fitAddon) fitAddon.fit();
    }, 250);
  }
);

/**
 * Back on screen: measured again, and nothing else.
 *
 * A tab coming forward must not disturb the shell behind it. It was never torn
 * down and never reconnected — what it lost while it was hidden is only the size
 * of its box, because a hidden box has none.
 */
watch(
  () => props.visible,
  (shown) => {
    if (!shown || !term) return;
    setTimeout(() => {
      // Fitting is what tells the shell its new size: the addon measures the box
      // and the terminal's own resize event carries the answer to the server.
      fitAddon?.fit();
      focusTerminal();
    }, 250);
  }
);

onMounted(() => {
  if (props.active) initTerminal();
});

onBeforeUnmount(() => {
  teardownTerminal();
});

defineExpose({ focus: () => focusTerminal() });
</script>
