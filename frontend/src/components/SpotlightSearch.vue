<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDebounceFn, useMagicKeys, whenever, onKeyStroke } from '@vueuse/core';
import { MagnifyingGlassIcon } from '@heroicons/vue/24/outline';
import { search as searchApi, normalizePath } from '@/api';
import { useSpotlightStore } from '@/stores/spotlight';
import FileIcon from '@/icons/FileIcon.vue';

const router = useRouter();
const route = useRoute();
const spotlight = useSpotlightStore();

const query = ref('');
const inputRef = ref(null);
const results = ref([]);
const loading = ref(false);
const errorMsg = ref('');
const activeIndex = ref(-1);

const basePath = computed(() => {
  // Prefer current browse path; fall back to explicit query param
  const fromBrowse = route.path.startsWith('/browse') && typeof route.params.path === 'string' ? route.params.path : '';
  const fromQuery = typeof route.query.path === 'string' ? route.query.path : '';
  return normalizePath(fromBrowse || fromQuery || '');
});

const performSearch = useDebounceFn(async () => {
  const term = query.value.trim();
  results.value = [];
  errorMsg.value = '';
  activeIndex.value = -1;
  if (!term) return;
  loading.value = true;
  try {
    const { items = [] } = await searchApi(basePath.value, term);
    results.value = Array.isArray(items) ? items : [];
  } catch (e) {
    errorMsg.value = e?.message || 'Search failed';
  } finally {
    loading.value = false;
  }
}, 200);

watch(query, () => {
  performSearch();
});

watch(() => spotlight.isOpen, async (open) => {
  if (open) {
    await nextTick();
    query.value = '';
    results.value = [];
    errorMsg.value = '';
    activeIndex.value = -1;
    inputRef.value && inputRef.value.focus();
  }
});

function openResult(it) {
  if (!it) return;
  const kind = it.kind === 'dir' ? 'dir' : 'file';
  const target = kind === 'dir'
    ? [it.path, it.name].filter(Boolean).join('/')
    : (it.path || '');
  const normalized = normalizePath(target || '');
  router.push({ path: `/browse/${normalized}` });
  spotlight.close();
}

// Input itself no longer handles keydown; we rely on VueUse handlers above

// VueUse keyboard helpers
const keys = useMagicKeys();

// Helper to avoid handling when user is typing in other inputs/editable fields
const isEditableElement = (el) => {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (el.isContentEditable) return true;
  return false;
};
const shouldIgnore = () => isEditableElement(document.activeElement);

// Open spotlight with ⌘K / Ctrl+K
const openCombo = computed(() => (keys['Meta+K']?.value || keys['Ctrl+K']?.value));
whenever(openCombo, () => {
  if (spotlight.isOpen) return;
  if (shouldIgnore()) return;
  spotlight.open();
});

// Close on Escape when open
const escWhenOpen = computed(() => Boolean(keys.escape?.value) && spotlight.isOpen);
whenever(escWhenOpen, () => {
  spotlight.close();
});

// Arrow navigation and submit when spotlight is open
onKeyStroke('ArrowDown', (e) => {
  if (!spotlight.isOpen) return;
  const count = results.value.length;
  if (count === 0) return;
  e.preventDefault();
  activeIndex.value = (activeIndex.value + 1) % count;
}, { eventName: 'keydown' });

onKeyStroke('ArrowUp', (e) => {
  if (!spotlight.isOpen) return;
  const count = results.value.length;
  if (count === 0) return;
  e.preventDefault();
  activeIndex.value = (activeIndex.value - 1 + count) % count;
}, { eventName: 'keydown' });

onKeyStroke('Enter', (e) => {
  if (!spotlight.isOpen) return;
  const count = results.value.length;
  if (count === 0) return;
  e.preventDefault();
  const it = results.value[Math.max(0, activeIndex.value)];
  if (it) openResult(it);
}, { eventName: 'keydown' });

</script>

<template>
  <transition name="fade">
    <div v-if="spotlight.isOpen" class="fixed inset-0 z-[550] flex items-start justify-center pt-[10vh]">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="spotlight.close()"></div>

      <div class="relative w-[90%] sm:w-[640px] max-w-[720px] rounded-2xl shadow-2xl border border-neutral-200/70 dark:border-neutral-700/60 bg-white/90 dark:bg-zinc-800/95  overflow-hidden">
        <!-- Input row -->
        <div class="flex items-center gap-2 px-4 py-3 border-b border-neutral-200/70 dark:border-neutral-800/80">
          <MagnifyingGlassIcon class="w-5 h-5 text-neutral-500 dark:text-neutral-400" />
          <input
            ref="inputRef"
            v-model="query"
            type="text"
            spellcheck="false"
            placeholder="Search files and folders…"
            class="flex-1 bg-transparent outline-none text-[15px] placeholder-neutral-400 dark:placeholder-neutral-500 text-neutral-900 dark:text-neutral-100"
          />
          <div class="hidden sm:flex items-center gap-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            <span class="px-1.5 py-[2px] rounded border text-white border-neutral-500 dark:border-neutral-700 bg-neutral-500 dark:bg-neutral-900">Esc</span>
            <span>Close</span>
          </div>
        </div>

        <!-- Results -->
        <div class="max-h-[60vh] overflow-y-auto">
          <div v-if="loading" class="px-4 py-3 text-sm text-neutral-500 dark:text-neutral-400">Searching…</div>
          <div v-else-if="errorMsg" class="px-4 py-3 text-sm text-red-600">{{ errorMsg }}</div>
          <div v-else-if="!query.trim()" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">Type to search within <span class="font-mono">/{{ basePath }}</span></div>
          <div v-else-if="results.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">No matches found.</div>

          <div v-else class="divide-y divide-neutral-100 dark:divide-neutral-800">
            <button
              v-for="(it, idx) in results"
              :key="it.path + '/' + it.name"
              type="button"
              class="w-full text-left px-3 py-2 hover:bg-zinc-300/60 dark:hover:bg-slate-300/10 focus:bg-blue-50/70 dark:focus:bg-blue-500/10 outline-none"
              :class="idx === activeIndex ? 'bg-zinc-300/60 dark:bg-slate-300/10' : ''"
              @mouseenter="activeIndex = idx"
              @click="openResult(it)"
            >
              <div class="flex items-center gap-3">
                <FileIcon :item="toIconItem(it)" class="w-8 h-8 shrink-0" />
                <div class="min-w-0">
                  <div class="text-[15px] text-neutral-900 dark:text-neutral-100 truncate">{{ it.name }}</div>
                  <div class="text-[12px] text-neutral-500 dark:text-neutral-400 font-mono truncate">/{{ it.path }}</div>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<script>
export default {
  methods: {
    toIconItem(it) {
      if (!it) return { name: '', path: '', kind: 'unknown' };
      const isDir = it.kind === 'dir';
      let ext = 'unknown';
      if (!isDir) {
        const name = String(it.name || '');
        const idx = name.lastIndexOf('.');
        if (idx > 0 && idx < name.length - 1) {
          ext = name.slice(idx + 1).toLowerCase();
          if (ext.length > 10) ext = 'unknown';
        } else {
          ext = 'unknown';
        }
      }
      return {
        name: it.name,
        path: it.path,
        kind: isDir ? 'directory' : ext,
      };
    }
  }
}
</script>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.12s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
