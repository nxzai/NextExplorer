<script setup>
import { computed, onMounted, ref } from 'vue';
import { useFeaturesStore } from '@/stores/features';

const features = useFeaturesStore();

// Default: block rendering until we know the app is safe to use.
const blocked = ref(true);
const mode = ref('checking'); // checking | mismatch | error

const requestOrigin = computed(() => window.location.origin);
const expectedOrigin = computed(() => features.publicOrigin || '');

const reload = () => window.location.reload();

onMounted(async () => {
  try {
    await features.ensureLoaded();
    if (!expectedOrigin.value || expectedOrigin.value === requestOrigin.value) {
      blocked.value = false;
      return;
    }
    mode.value = 'mismatch';
  } catch (_) {
    mode.value = 'error';
  }
});
</script>

<template>
  <div v-if="blocked" class="min-h-dvh w-full bg-blue-700 text-white">
    <div class="mx-auto max-w-4xl px-6 py-14">
      <div class="font-mono text-7xl leading-tighter tracking-tighter">:(</div>
      <h1 class="mt-5 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
        This app isn’t configured correctly.
      </h1>

      <div class="mt-4 text-base text-white/90">
        <span v-if="mode === 'checking'">Checking server configuration…</span>
        <span v-else-if="mode === 'mismatch'">
          <p class="mt-3 max-w-prose text-pretty text-base leading-relaxed text-white">
            You opened the app from a different address than the server expects. Login, sharing, and
            other features may not work until you use the correct URL.
          </p>
        </span>
        <span v-else>Could not load server settings. The server may be down.</span>
      </div>

      <div v-if="mode === 'mismatch'" class="mt-10 space-y-6">
        <div>
          <div class="text-xs uppercase tracking-wider text-white/70 mb-4">Correct URL</div>
          <span class="rounded-md bg-black/25 p-4 font-mono text-sm break-all">
            {{ expectedOrigin }}
          </span>
          <div class="mt-4 text-xs text-white/70">
            You opened: <span class="font-mono break-all">{{ requestOrigin }}</span>
          </div>
        </div>

        <div>
          <div class="text-xs uppercase tracking-wider text-white/70 mb-4">Admin fix</div>
          <span class="rounded-md bg-black/25 p-4 font-mono text-sm break-all">
            PUBLIC_URL={{ requestOrigin }}
          </span>
          <div class="mt-4 text-xs text-white/70">Update it on the server and restart.</div>
        </div>
      </div>

      <div class="mt-10 flex flex-wrap gap-3">
        <a
          v-if="mode === 'mismatch'"
          href="#"
          target="_blank"
          class="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-blue-800 hover:bg-white/90"
        >
          Read More
        </a>
        <button
          v-if="mode !== 'checking'"
          type="button"
          class="inline-flex items-center justify-center rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15"
          @click="reload"
        >
          Reload
        </button>
      </div>
    </div>
  </div>

  <slot v-else></slot>
</template>
