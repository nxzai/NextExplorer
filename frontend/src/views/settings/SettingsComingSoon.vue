<template>
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {{ $t('titles.comingSoon') }}
      </h2>
      <p class="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
        {{ $t('settings.comingSoon.subtitle') }}
      </p>
    </div>

    <!-- Content -->
    <div
      class="bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-800 p-12 text-center"
    >
      <div class="mx-auto max-w-md">
        <div
          class="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 mb-4"
        >
          <svg
            class="h-8 w-8 text-zinc-400 dark:text-zinc-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          {{ $t('settings.comingSoon.subtitle') }}
        </p>
      </div>
    </div>
  </div>
</template>
