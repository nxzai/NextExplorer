<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { createApiToken, listApiTokens, renameApiToken, revokeApiToken } from '@/api';
import { formatLocalDateTime } from '@/utils';
import { useAuthStore } from '@/stores/auth';
import { useAsk } from '@/composables/useAsk';

/**
 * The API tokens on this account.
 *
 * One thing here is unlike every other settings page: the value of a new token
 * exists for as long as this page holds it and never again. So it is shown
 * once, plainly, beside the one line somebody actually needs — the header to
 * put on a request — and the page says so rather than letting anybody find out
 * by closing the panel.
 */

const auth = useAuthStore();
const { t } = useI18n();
const { ask, askFor } = useAsk();

const tokens = ref([]);
const busy = ref(false);
const errorMsg = ref('');
const successMsg = ref('');

const newName = ref('');
const newScope = ref('read');
const newExpiry = ref('never');
const passwordValue = ref('');

/** The value of the token that was just made. Held here and nowhere else. */
const issued = ref(null);
const copied = ref(false);

const hasPassword = computed(() => auth.currentUser?.provider === 'local');

const buttonClasses =
  'inline-flex justify-center rounded-md border border-transparent bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-zinc-800 focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:outline-hidden disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200';
const quietButtonClasses =
  'inline-flex justify-center rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
const inputClasses =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

const EXPIRIES = [
  { value: 'never', days: null },
  { value: '30', days: 30 },
  { value: '90', days: 90 },
  { value: '365', days: 365 },
];

const resetMessages = () => {
  errorMsg.value = '';
  successMsg.value = '';
};

const refresh = async () => {
  const { tokens: held } = await listApiTokens();
  tokens.value = Array.isArray(held) ? held : [];
};

onMounted(async () => {
  try {
    await refresh();
  } catch (error) {
    errorMsg.value = error?.message || t('settings.apiTokens.loadFailed');
  }
});

const create = async () => {
  resetMessages();
  issued.value = null;
  copied.value = false;
  busy.value = true;
  try {
    const chosen = EXPIRIES.find((entry) => entry.value === newExpiry.value);
    const { token, secret } = await createApiToken({
      name: newName.value.trim() || undefined,
      scope: newScope.value,
      expiresInDays: chosen ? chosen.days : null,
      password: passwordValue.value || undefined,
    });
    issued.value = { token, secret };
    newName.value = '';
    passwordValue.value = '';
    await refresh();
  } catch (error) {
    errorMsg.value = error?.message || t('settings.apiTokens.createFailed');
  } finally {
    busy.value = false;
  }
};

const rename = async (token) => {
  resetMessages();
  const name = await askFor({
    title: t('settings.apiTokens.renameTitle'),
    label: t('settings.apiTokens.renamePrompt'),
    value: token.name,
    confirmLabel: t('settings.apiTokens.rename'),
  });
  if (name === null) return;
  busy.value = true;
  try {
    await renameApiToken(token.id, name.trim());
    await refresh();
    successMsg.value = t('settings.apiTokens.renamed');
  } catch (error) {
    errorMsg.value = error?.message || t('settings.apiTokens.renameFailed');
  } finally {
    busy.value = false;
  }
};

const revoke = async (token) => {
  resetMessages();
  const go = await ask({
    title: t('settings.apiTokens.revokeTitle'),
    body: t('settings.apiTokens.revokeConfirm', { name: token.name }),
    confirmLabel: t('settings.apiTokens.revoke'),
    tone: 'danger',
  });
  if (!go) return;
  busy.value = true;
  try {
    await revokeApiToken(token.id);
    if (issued.value?.token?.id === token.id) issued.value = null;
    await refresh();
    successMsg.value = t('settings.apiTokens.revoked', { name: token.name });
  } catch (error) {
    errorMsg.value = error?.message || t('settings.apiTokens.revokeFailed');
  } finally {
    busy.value = false;
  }
};

const copySecret = async () => {
  if (!issued.value) return;
  try {
    await navigator.clipboard.writeText(issued.value.secret);
    copied.value = true;
  } catch {
    // A browser that will not copy is not an error worth a red box: the value
    // is on screen and can be selected.
    copied.value = false;
  }
};

const usedAt = (token) =>
  token.lastUsedAt
    ? t('settings.apiTokens.lastUsed', {
        when: formatLocalDateTime(token.lastUsedAt),
        from: token.lastUsedIp || t('settings.apiTokens.unknownAddress'),
      })
    : t('settings.apiTokens.neverUsed');

const expiryOf = (token) =>
  token.expiresAt
    ? t('settings.apiTokens.expiresOn', { when: formatLocalDateTime(token.expiresAt) })
    : t('settings.apiTokens.neverExpires');

const scopeOf = (token) =>
  token.scope === 'write' ? t('settings.apiTokens.scopeWrite') : t('settings.apiTokens.scopeRead');
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {{ t('settings.apiTokens.title') }}
      </h2>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {{ t('settings.apiTokens.intro') }}
      </p>
    </div>

    <div
      class="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div class="max-w-2xl space-y-6">
        <p
          v-if="errorMsg"
          class="rounded-md bg-red-100 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
          data-test="tokens-error"
        >
          {{ errorMsg }}
        </p>
        <p
          v-if="successMsg"
          class="rounded-md bg-green-100 p-4 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
          data-test="tokens-success"
        >
          {{ successMsg }}
        </p>

        <!-- The one moment the value exists. Said plainly, because finding it
             out by closing the page is the wrong way to learn it. -->
        <div
          v-if="issued"
          class="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
          data-test="token-issued"
        >
          <p class="text-sm font-medium text-amber-900 dark:text-amber-200">
            {{ t('settings.apiTokens.shownOnce') }}
          </p>
          <code
            class="block w-full break-all rounded-sm bg-white p-3 font-mono text-xs text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100"
            data-test="token-secret"
            >{{ issued.secret }}</code
          >
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              :class="quietButtonClasses"
              data-test="token-copy"
              @click="copySecret"
            >
              {{ copied ? t('settings.apiTokens.copied') : t('settings.apiTokens.copy') }}
            </button>
            <span class="text-xs text-amber-800 dark:text-amber-300">
              {{ t('settings.apiTokens.useIt') }}
            </span>
          </div>
          <code
            class="block w-full overflow-x-auto rounded-sm bg-white p-3 font-mono text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300"
            data-test="token-example"
            >Authorization: Bearer {{ issued.secret }}</code
          >
        </div>

        <ul v-if="tokens.length" class="divide-y divide-zinc-200 dark:divide-zinc-800">
          <li
            v-for="token in tokens"
            :key="token.id"
            class="flex flex-wrap items-center justify-between gap-3 py-3"
            data-test="token"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {{ token.name }}
                <span
                  class="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  data-test="token-scope-badge"
                  >{{ scopeOf(token) }}</span
                >
              </p>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                {{
                  t('settings.apiTokens.createdOn', { when: formatLocalDateTime(token.createdAt) })
                }}<span> · </span>{{ usedAt(token) }}<span> · </span>{{ expiryOf(token) }}
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                type="button"
                :class="quietButtonClasses"
                :disabled="busy"
                data-test="token-rename"
                @click="rename(token)"
              >
                {{ t('settings.apiTokens.rename') }}
              </button>
              <button
                type="button"
                :class="quietButtonClasses"
                :disabled="busy"
                data-test="token-revoke"
                @click="revoke(token)"
              >
                {{ t('settings.apiTokens.revoke') }}
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-zinc-600 dark:text-zinc-300" data-test="tokens-none">
          {{ t('settings.apiTokens.none') }}
        </p>

        <div class="space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h3 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {{ t('settings.apiTokens.newToken') }}
          </h3>

          <div class="space-y-1">
            <label
              for="token-name"
              class="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              {{ t('settings.apiTokens.nameLabel') }}
            </label>
            <input
              id="token-name"
              v-model="newName"
              type="text"
              maxlength="60"
              :placeholder="t('settings.apiTokens.namePlaceholder')"
              :class="[inputClasses, 'max-w-sm']"
              data-test="token-name"
            />
          </div>

          <fieldset class="space-y-1">
            <legend class="block text-sm font-medium text-zinc-700 dark:text-zinc-200">
              {{ t('settings.apiTokens.scopeLabel') }}
            </legend>
            <select
              v-model="newScope"
              :class="[inputClasses, 'max-w-sm']"
              data-test="token-scope"
              :aria-label="t('settings.apiTokens.scopeLabel')"
            >
              <option value="read">{{ t('settings.apiTokens.scopeRead') }}</option>
              <option value="write">{{ t('settings.apiTokens.scopeWrite') }}</option>
            </select>
            <p class="text-xs text-zinc-500 dark:text-zinc-400">
              {{
                newScope === 'write'
                  ? t('settings.apiTokens.scopeWriteHelp')
                  : t('settings.apiTokens.scopeReadHelp')
              }}
            </p>
          </fieldset>

          <div class="space-y-1">
            <label
              for="token-expiry"
              class="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              {{ t('settings.apiTokens.expiryLabel') }}
            </label>
            <select
              id="token-expiry"
              v-model="newExpiry"
              :class="[inputClasses, 'max-w-sm']"
              data-test="token-expiry"
            >
              <option value="never">{{ t('settings.apiTokens.expiryNever') }}</option>
              <option value="30">{{ t('settings.apiTokens.expiryDays', { days: 30 }) }}</option>
              <option value="90">{{ t('settings.apiTokens.expiryDays', { days: 90 }) }}</option>
              <option value="365">{{ t('settings.apiTokens.expiryDays', { days: 365 }) }}</option>
            </select>
          </div>

          <!-- The password stands between a browser left unlocked and a
               credential that outlives the session it was made from. -->
          <div v-if="hasPassword" class="space-y-1">
            <label
              for="token-password"
              class="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
            >
              {{ t('settings.apiTokens.confirmPassword') }}
            </label>
            <input
              id="token-password"
              v-model="passwordValue"
              type="password"
              autocomplete="current-password"
              :class="[inputClasses, 'max-w-sm']"
              data-test="token-password"
            />
          </div>

          <button
            type="button"
            :class="buttonClasses"
            :disabled="busy"
            data-test="token-create"
            @click="create"
          >
            {{ t('settings.apiTokens.create') }}
          </button>
        </div>

        <p class="text-xs text-zinc-500 dark:text-zinc-400" data-test="tokens-limits">
          {{ t('settings.apiTokens.limits') }}
        </p>
      </div>
    </div>
  </div>
</template>
