<script setup>
import { usePaneRoute, usePaneTabId } from '@/composables/paneTab';
import { computed, onMounted, watch } from 'vue';

import { useI18n } from 'vue-i18n';
import { normalizePath } from '@/api';
import { usePageTitle } from '@/composables/usePageTitle';
import { useTerminalStore } from '@/stores/terminal';

/**
 * A tab that is a terminal.
 *
 * Opened deliberately — command or control, or the middle button, on the same
 * entry that otherwise opens the drawer — because a shell taking a whole tab is
 * a decision rather than what asking for a terminal means.
 *
 * This page draws no terminal. It says that its tab wants one and that it wants
 * the whole of the tab, and `TerminalHost.vue` draws it, along with every other
 * terminal that is open. That is not an indirection for its own sake: a page is
 * unmounted the moment another tab comes forward, and a terminal that is
 * unmounted is a shell that has been killed. The host outlives every tab, so the
 * session does too — which is the whole promise, that a tab left running is
 * running when it is come back to.
 *
 * The folder in the address is the folder the shell starts in, exactly as the
 * drawer starts in the folder it was opened from.
 */
const route = usePaneRoute();
const paneTabId = usePaneTabId();
const { t } = useI18n();
const terminalStore = useTerminalStore();

const folder = computed(() => {
  const raw = route.params.path;
  const joined = Array.isArray(raw) ? raw.join('/') : typeof raw === 'string' ? raw : '';
  return normalizePath(joined);
});

const name = computed(() => folder.value.split('/').filter(Boolean).pop() || '');

// Named after the folder it is in, as a tab of a folder is: two shells both
// reading "Terminal" are two tabs nobody can tell apart.
usePageTitle(
  computed(() => (name.value ? `${t('titles.terminal')} — ${name.value}` : t('titles.terminal')))
);

/**
 * Claimed on the way in, and again whenever this tab is taken to another folder.
 *
 * Asking twice for the same folder is not asking for anything: the store answers
 * with the session that is already there, so a tab coming back to itself comes
 * back to the shell it left running rather than to a new one.
 *
 * Claimed for the tab of the *pane* this page is drawn in, which is the tab in
 * front only when there is one pane. A shell dropped into the half beside the
 * reader asked for the tab in front and got the neighbour: the session went to the
 * folder tab, and the half holding the shell drew the dark ground of this page and
 * nothing else.
 */
const claim = () => terminalStore.openIn(paneTabId.value, folder.value, { mode: 'page' });
onMounted(claim);
watch(folder, claim);
</script>

<template>
  <!-- The ground the host's terminal sits on, so nothing flashes white between
       this page arriving and the terminal being drawn over it. -->
  <div class="h-full w-full bg-zinc-900 dark:bg-zinc-950" data-test="terminal-page"></div>
</template>
