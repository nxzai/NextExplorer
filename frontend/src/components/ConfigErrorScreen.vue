<script setup>
const props = defineProps({
  mode: {
    type: String,
    default: 'mismatch', // mismatch | error
  },
  expectedOrigin: {
    type: String,
    default: '',
  },
  requestOrigin: {
    type: String,
    default: '',
  },
});

const corsDocsUrl = 'https://github.com/vikramsoni2/nextExplorer/blob/main/docs/reference/cors.md';
const reload = () => window.location.reload();
</script>

<template>
  <div class="min-h-dvh w-full bg-blue-700 text-white">
    <div class="mx-auto max-w-4xl px-6 py-14">
      <div class="font-mono text-7xl leading-tighter tracking-tighter">:(</div>
      <h1 class="mt-5 text-balance text-3xl font-semibold tracking-tight md:text-4xl">
        This app isn’t configured correctly.
      </h1>

      <div class="mt-4 text-base text-white/90">
        <span v-if="props.mode === 'mismatch'">
          <p class="mt-3 max-w-prose text-pretty text-base leading-relaxed text-white">
            You opened the app from a different address than the server expects. Login, sharing, and
            other features may not work until you use the correct URL.
          </p>
        </span>
        <span v-else>Could not load server settings. The server may be down.</span>
      </div>

      <div v-if="props.mode === 'mismatch'" class="mt-10 space-y-6">
        <div>
          <div class="text-xs uppercase tracking-wider text-white/70 mb-4">Correct URL</div>
          <span class="rounded-md bg-black/25 p-4 font-mono text-sm break-all">
            {{ props.expectedOrigin }}
          </span>
          <div class="mt-4 text-xs text-white/70">
            You opened: <span class="font-mono break-all">{{ props.requestOrigin }}</span>
          </div>
        </div>

        <div>
          <div class="text-xs uppercase tracking-wider text-white/70 mb-4">Admin fix</div>
          <span class="rounded-md bg-black/25 p-4 font-mono text-sm break-all">
            PUBLIC_URL={{ props.requestOrigin }}
          </span>
          <div class="mt-4 text-xs text-white/70">Update it on the server and restart.</div>
        </div>
      </div>

      <div class="mt-10 flex flex-wrap gap-3">
        <a
          v-if="props.mode === 'mismatch'"
          :href="corsDocsUrl"
          target="_blank"
          class="inline-flex items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-blue-800 hover:bg-white/90"
        >
          Read More
        </a>
        <button
          type="button"
          class="inline-flex items-center justify-center rounded-md bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/15"
          @click="reload"
        >
          Reload
        </button>
      </div>
    </div>
  </div>
</template>
