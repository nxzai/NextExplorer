<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import HeaderLogo from '@/components/HeaderLogo.vue';
import ModalDialog from '@/components/ModalDialog.vue';
import { LockClosedIcon, KeyIcon, InformationCircleIcon, XMarkIcon, ChevronUpDownIcon } from '@heroicons/vue/24/outline';
import { useStorage, onClickOutside } from '@vueuse/core';
import { apiBase } from '@/api';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useFeaturesStore } from '@/stores/features';

const version = __APP_VERSION__

const auth = useAuthStore();
const { t, locale } = useI18n();
const router = useRouter();
const route = useRoute();

const loginEmailValue = ref('');
const loginPasswordValue = ref('');
const loginError = ref('');
const isSubmittingLogin = ref(false);
const showResetInfo = ref(false);

const statusError = computed(() => auth.lastError || '');
const supportsLocal = computed(() => auth.strategies?.local !== false);
const supportsOidc = computed(() => Boolean(auth.strategies?.oidc));
const redirectTarget = computed(() => {
  const redirect = route.query?.redirect;
  if (typeof redirect === 'string' && redirect.trim()) {
    return redirect;
  }
  return '/browse/';
});

const inputBaseClasses =
  'mt-2 w-full h-12 rounded-lg ring-1 ring-inset ring-white/10 bg-zinc-800/70 px-4 text-nextgray-100 placeholder-zinc-500 focus:ring-accent/60 focus:outline-none transition';

const buttonBaseClasses =
  'w-full h-12 rounded-lg bg-accent px-4 font-semibold text-nextzinc-900 transition hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60';

const helperTextClasses = 'text-sm text-red-400';

// Announcements pulled from public features endpoint
const announcement = ref(null);
const hasAnnouncement = computed(() => Boolean(announcement.value));

// Announcement callout styles, tailored for dark login background
const LEVEL_BORDER = Object.freeze({
  info: 'border-blue-400/70',
  success: 'border-emerald-400/70',
  warning: 'border-amber-400/70',
  error: 'border-rose-400/70',
});
const LEVEL_ICON = Object.freeze({
  info: 'text-blue-300',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  error: 'text-rose-300',
});

// Persist dismissal locally for the login route only
const dismissedOnLogin = useStorage('auth-login:announcements:dismissed', {});
const currentAnnouncementId = computed(() => String(announcement.value?.id || '__generic'));
const showAnnouncement = computed(() => hasAnnouncement.value && !dismissedOnLogin.value[currentAnnouncementId.value]);
const dismissAnnouncement = () => {
  const id = currentAnnouncementId.value;
  dismissedOnLogin.value = { ...(dismissedOnLogin.value || {}), [id]: true };
};

const availableLocaleOptions = [
  { code: 'en', label: 'i18n.english' },
  { code: 'es', label: 'i18n.spanish' },
  { code: 'fr', label: 'i18n.french' },
  { code: 'de', label: 'i18n.german' },
  { code: 'zh', label: 'i18n.chinese' },
  { code: 'hi', label: 'i18n.hindi' },
  { code: 'pl', label: 'i18n.polish' },
];

const languages = computed(() => availableLocaleOptions.map(({ code, label }) => ({
  code,
  label: t(label),
})));

const currentLanguage = computed(() => {
  const list = languages.value;
  return (
    list.find((lang) => lang.code === locale.value) ||
    list[0] ||
    { code: locale.value, label: locale.value.toUpperCase() }
  );
});

const languageMenuOpen = ref(false);
const languageSwitcherRef = ref(null);

function setLocale(lang) {
  try { localStorage.setItem('locale', lang); } catch (_) {}
  if (typeof document !== 'undefined') { document.documentElement.setAttribute('lang', lang); }
  locale.value = lang;
}

onClickOutside(languageSwitcherRef, () => {
  languageMenuOpen.value = false;
});

const redirectToDestination = () => {
  const target = redirectTarget.value;
  router.replace(typeof target === 'string' ? target : '/browse/');
};

watch(
  () => auth.isAuthenticated,
  (isAuthenticated) => {
    if (isAuthenticated) {
      redirectToDestination();
    }
  },
  { immediate: true },
);

watch(
  () => auth.requiresSetup,
  (requiresSetup) => {
    if (requiresSetup && auth.hasStatus) {
      const redirect = redirectTarget.value;
      router.replace({ name: 'auth-setup', ...(redirect ? { query: { redirect } } : {}) });
    }
  },
  { immediate: true },
);

onMounted(async () => {
  if (!auth.hasStatus && !auth.isLoading) {
    auth.initialize();
  }
  try {
    const featuresStore = useFeaturesStore();
    await featuresStore.ensureLoaded();
    const anns = featuresStore.announcements || [];
    // Prefer the migration announcement if present; else show the first
    const mig = anns.find(a => a?.id === 'v3-user-migration');
    announcement.value = mig || anns[0] || null;
  } catch (_) {
    // Non-fatal; announcements are optional
  }
});

const resetErrors = () => {
  loginError.value = '';
  auth.clearError();
};

const handleLoginSubmit = async () => {
  resetErrors();

  if (!supportsLocal.value) {
    loginError.value = t('auth.errors.localSignInDisabled');
    return;
  }

  if (!loginEmailValue.value.trim()) {
    loginError.value = t('auth.errors.emailRequired');
    return;
  }

  if (!loginPasswordValue.value) {
    loginError.value = t('auth.errors.passwordRequired');
    return;
  }

  isSubmittingLogin.value = true;

  try {
    await auth.login({
      email: loginEmailValue.value.trim(),
      password: loginPasswordValue.value,
    });
    loginEmailValue.value = '';
    loginPasswordValue.value = '';
    redirectToDestination();
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : t('auth.errors.signInFailed');
  } finally {
    isSubmittingLogin.value = false;
  }
};

const handleOidcLogin = () => {
  resetErrors();
  const returnTo = redirectTarget.value;
  const base = apiBase || '';
  // Prefer EOC's native /login route; Vite proxies /login to backend in dev.
  const loginUrl = `${base}/login`;
  const finalUrl = returnTo && typeof returnTo === 'string'
    ? `${loginUrl}?returnTo=${encodeURIComponent(returnTo)}`
    : loginUrl;
  window.location.href = finalUrl;
};
</script>

<template>
  <div class="min-h-screen bg-nextzinc-900 text-nextgray-100">
    <!-- Loading state covering screen -->
    <div v-if="auth.isLoading" class="flex min-h-screen items-center justify-center px-4 py-12">
      <div class="flex flex-col items-center gap-3">
        <div class="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-accent"></div>
        <p class="text-lg font-medium tracking-wide text-nextgray-100/80">{{ $t('auth.preparing') }}</p>
      </div>
    </div>

    <div
      v-else
      class="relative isolate min-h-screen overflow-hidden bg-nextzinc-900"
    >
      <!-- SVG grid background with radial mask, inspired by Tailwind UI -->
      <svg
        aria-hidden="true"
        class="absolute inset-0 -z-10 h-full w-full stroke-white/10 [mask-image:radial-gradient(100%_100%_at_top_right,white,transparent)]"
      >
        <defs>
          <pattern
            id="auth-login-grid-pattern"
            width="200"
            height="200"
            x="50%"
            y="-1"
            patternUnits="userSpaceOnUse"
          >
            <path d="M.5 200V.5H200" fill="none" />
          </pattern>
        </defs>
        <svg x="50%" y="-1" class="overflow-visible fill-nextzinc-900">
          <path
            d="M-200 0h201v201h-201Z M600 0h201v201h-201Z M-400 600h201v201h-201Z M200 800h201v201h-201Z"
            stroke-width="0"
          />
        </svg>
        <rect
          width="100%"
          height="100%"
          fill="url(#auth-login-grid-pattern)"
          stroke-width="0"
        />
      </svg>

      <!-- Top blurred zinc gradient shape -->
      <div
        aria-hidden="true"
        class="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80"
      >
        <div
          style="clip-path: polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)"
          class="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-zinc-200/40 via-zinc-500/40 to-zinc-800/70 opacity-40 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]"
        ></div>
      </div>

      <!-- Bottom blurred zinc gradient shape -->
      <div
        aria-hidden="true"
        class="absolute inset-x-0 top-[calc(100%-13rem)] -z-10 transform-gpu overflow-hidden blur-3xl sm:top-[calc(100%-30rem)]"
      >
        <div
          style="clip-path: polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)"
          class="relative left-[calc(50%+3rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 bg-gradient-to-tr from-zinc-200/30 via-zinc-500/30 to-zinc-800/60 opacity-35 sm:left-[calc(50%+36rem)] sm:w-[72.1875rem]"
        ></div>
      </div>

      <!-- Small neutral spot near version badge -->
      <div
        aria-hidden="true"
        class="pointer-events-none absolute right-5 top-0 -z-10 h-40 w-40   transform-gpu blur-3xl"
      >
        <div
          class="h-full w-full rounded-full bg-[radial-gradient(circle_at_center,_rgba(244,244,245,0.3),transparent_60%)]"
        ></div>
      </div>

      <div class="flex min-h-screen flex-col">
        <!-- Top: Branding -->
        <header class="flex items-center justify-between px-6 py-6 sm:px-12">
          <h1 class="mb-0 text-2xl font-bold tracking-tight text-white">
            <HeaderLogo appname="NextExplorer" />
          </h1>
          <span
            class="inline-flex h-9 items-center rounded-full bg-white/5 px-3 text-xs font-semibold uppercase tracking-widest text-white/70"
          >
            v{{ version }}
          </span>
        </header>

        <!-- Center: Auth form -->
        <main class="flex flex-1 items-center justify-center px-6 pb-8 sm:px-12">
          <div class="relative z-10 w-full max-w-md">
            <!-- frosted glass card -->
            <div
              class="relative w-full rounded-2xl border border-white/15 bg-neutral-900/10 px-6 py-6 shadow-2xl shadow-black/50 backdrop-blur-xl sm:px-8 sm:py-8"
            >
              <div class="mb-6">
                <p class="text-3xl font-black leading-tight tracking-tight text-white">
                  {{ $t('auth.login.welcome') }}
                </p>
                <p class="mt-2 text-sm text-white/60">{{ $t('auth.login.subtitle') }}</p>
              </div>

              <!-- Inline announcement if available -->
              <div v-if="showAnnouncement" class="mb-6">
                <div
                  class="relative rounded-xl border-l-4 bg-white/5 px-4 py-4 shadow-lg shadow-black/30 ring-1 ring-inset ring-white/10"
                  :class="LEVEL_BORDER[announcement.level] || LEVEL_BORDER.info"
                  aria-live="polite"
                >
                  <button
                    type="button"
                    class="absolute right-2 top-2 rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white/90"
                    :aria-label="$t('common.dismiss')"
                    @click="dismissAnnouncement"
                  >
                    <XMarkIcon class="h-4 w-4" />
                  </button>
                  <div class="flex items-start gap-3">
                    <InformationCircleIcon
                      class="mt-0.5 h-6 w-6 flex-shrink-0"
                      :class="LEVEL_ICON[announcement.level] || LEVEL_ICON.info"
                    />
                    <div class="flex-1">
                      <h3 v-if="announcement.title" class="mb-2 font-semibold text-blue-300">
                        <span v-if="announcement.id === 'v3-user-migration'">
                          {{ $t('auth.login.announcementMigration.title') }}
                        </span>
                        <span v-else>
                          {{ announcement.title }}
                        </span>
                      </h3>
                      <div class="whitespace-pre-line text-sm leading-relaxed text-white/80">
                        <template v-if="announcement.id === 'v3-user-migration'">
                          <p class="-ml-6">
                            {{ $t('auth.login.announcementMigration.intro') }}
                          </p>
                          <ul class="list-disc">
                            <li>
                              <span
                                v-html="$t('auth.login.announcementMigration.bulletAddSuffix', { suffix: '<span class=&quot;px-2 font-bold text-yellow-300&quot;>@example.local</span>' })"
                              />
                            </li>
                            <li>
                              {{ $t('auth.login.announcementMigration.bulletPasswordSame') }}
                            </li>
                            <li>
                              {{ $t('auth.login.announcementMigration.bulletUpdateUsers') }}
                            </li>
                          </ul>
                        </template>
                        <template v-else>
                          <p>
                            {{ announcement.message }}
                          </p>
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Email/password form -->
              <form v-if="supportsLocal" class="space-y-5" @submit.prevent="handleLoginSubmit">
                <label class="block">
                  <span class="block text-sm font-medium text-white/80">{{ $t('auth.email') }}</span>
                  <input
                    id="login-email"
                    v-model="loginEmailValue"
                    type="email"
                    autocomplete="email"
                    :class="inputBaseClasses"
                    :placeholder="$t('auth.emailPlaceholder')"
                    :disabled="isSubmittingLogin"
                  />
                </label>

                <label class="block">
                  <span class="block text-sm font-medium text-white/80">{{ $t('auth.password') }}</span>
                  <input
                    id="login-password"
                    v-model="loginPasswordValue"
                    type="password"
                    autocomplete="current-password"
                    :class="inputBaseClasses"
                    placeholder="••••••••"
                    :disabled="isSubmittingLogin"
                  />
                  <div class="mt-2 mb-4 text-right">
                    <!-- <button
                  type="button"
                  class="text-xs font-medium text-white/70 underline-offset-4 hover:text-white hover:underline"
                  @click="showResetInfo = true"
                >
                  Forgot password?
                </button> -->
                  </div>
                </label>

                <p v-if="loginError" :class="helperTextClasses">{{ loginError }}</p>
                <p v-else-if="statusError" :class="helperTextClasses">{{ statusError }}</p>

                <button type="submit" :class="buttonBaseClasses" :disabled="isSubmittingLogin">
                  <span v-if="isSubmittingLogin">{{ $t('auth.verifying') }}</span>
                  <span v-else class="inline-flex items-center gap-2">
                    <LockClosedIcon class="h-5 w-5" />
                    {{ $t('auth.login.submit') }}
                  </span>
                </button>
              </form>

              <div v-if="supportsLocal && supportsOidc" class="my-4 flex items-center gap-4">
                <div class="h-px w-full bg-white/10"></div>
                <span class="text-xs text-white/50">{{ $t('common.or') }}</span>
                <div class="h-px w-full bg-white/10"></div>
              </div>

              <div v-if="supportsOidc" class="mb-2">
                <button
                  class="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-neutral-500/20 px-4 text-sm font-medium text-white ring-1 ring-inset ring-white/10 hover:bg-white/10"
                  type="button"
                  @click="handleOidcLogin"
                >
                  <KeyIcon class="h-5 w-5" />
                  <span class="truncate">{{ $t('auth.sso.continue') }}</span>
                </button>
              </div>

              <p
                v-if="!supportsLocal && statusError"
                class="mt-4"
                :class="helperTextClasses"
              >
                {{ statusError }}
              </p>
            </div>
          </div>
        </main>

        <!-- Bottom: Copyright & language switcher -->
        <footer class="flex items-center justify-between px-6 py-4 sm:px-12 text-xs text-white/60">
          <div>© {{ new Date().getFullYear() }} NextExplorer</div>

          <!-- Small screens: language popover -->
          <div class="flex items-center text-white/70 sm:hidden">
            <div ref="languageSwitcherRef" class="relative inline-block text-left">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 hover:bg-white/10 focus:outline-none"
                :aria-label="$t('i18n.language')"
                @click="languageMenuOpen = !languageMenuOpen"
              >
                <span class="uppercase tracking-wide text-[0.7rem]">
                  {{ currentLanguage.code }}
                </span>
                <span class="hidden text-xs">
                  {{ currentLanguage.label }}
                </span>
                <ChevronUpDownIcon class="h-4 w-4 text-white/60" />
              </button>

              <div
                v-if="languageMenuOpen"
                class="absolute right-0 bottom-full mb-2 z-20 w-44 rounded-lg border border-white/10 bg-nextzinc-900/95 py-1 text-xs shadow-lg backdrop-blur"
              >
                <button
                  v-for="lang in languages"
                  :key="lang.code"
                  type="button"
                  class="flex w-full items-center justify-between px-3 py-1.5 hover:bg-white/10"
                  :class="{ 'font-semibold text-white': $i18n.locale === lang.code }"
                  @click="setLocale(lang.code); languageMenuOpen = false"
                >
                  <span>{{ lang.label }}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Larger screens: inline language buttons -->
          <div class="hidden items-center text-white/70 sm:flex">
            <span class="mr-2">{{ $t('i18n.language') }}:</span>
            <template v-for="(lang, idx) in languages" :key="lang.code">
              <button
                type="button"
                class="rounded px-2 py-1 hover:bg-white/10"
                :class="{ 'bg-white/10 font-semibold': $i18n.locale === lang.code }"
                @click="setLocale(lang.code)"
              >
                {{ lang.label }}
              </button>
              <span v-if="idx < languages.length - 1" class="mx-2">•</span>
            </template>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>
