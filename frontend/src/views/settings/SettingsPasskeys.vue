<script setup>
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  createPasskey,
  deletePasskey,
  listPasskeys,
  passkeysSupported,
  renamePasskey,
} from '@/api';
import { formatLocalDateTime } from '@/utils';
import { useAuthStore } from '@/stores/auth';
import { useAsk } from '@/composables/useAsk';

/**
 * The passkeys on this account.
 *
 * A passkey is made by the browser and kept by the device, so this page does
 * very little: it asks for one, names it, and takes it away again. What it has
 * to do carefully is say why the button is not there when it cannot work — a
 * page served over plain http has no name for a passkey to be bound to, and a
 * browser that refuses says so in a way nobody can act on.
 */

const auth = useAuthStore();
const { t } = useI18n();
const { askFor } = useAsk();

const isLocalUser = computed(() => auth.currentUser?.provider === 'local');
const supported = ref(passkeysSupported());

const passkeys = ref([]);
const busy = ref(false);
const errorMsg = ref('');
const successMsg = ref('');
const newName = ref('');
const passwordValue = ref('');

const buttonClasses =
  'inline-flex justify-center rounded-md border border-transparent bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-zinc-800 focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:outline-hidden disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200';
const quietButtonClasses =
  'inline-flex justify-center rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
const inputClasses =
  'block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-500 focus:ring-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

const resetMessages = () => {
  errorMsg.value = '';
  successMsg.value = '';
};

const refresh = async () => {
  const { passkeys: held } = await listPasskeys();
  passkeys.value = Array.isArray(held) ? held : [];
};

onMounted(async () => {
  if (!isLocalUser.value) return;
  try {
    await refresh();
  } catch (error) {
    errorMsg.value = error?.message || t('settings.passkeys.loadFailed');
  }
});

/**
 * What a refusal from the browser means.
 *
 * `NotAllowedError` is what comes back both when somebody changed their mind
 * and when the ceremony timed out, and the browser will not say which — so it
 * is reported as the one thing that is certainly true.
 */
const messageFor = (error) => {
  if (error?.name === 'NotAllowedError') return t('settings.passkeys.cancelled');
  if (error?.name === 'InvalidStateError') return t('settings.passkeys.alreadyHere');
  return error?.message || t('settings.passkeys.addFailed');
};

const add = async () => {
  resetMessages();
  busy.value = true;
  try {
    const { passkey } = await createPasskey({ name: newName.value.trim() || undefined });
    newName.value = '';
    await refresh();
    successMsg.value = t('settings.passkeys.added', { name: passkey?.name || '' });
  } catch (error) {
    errorMsg.value = messageFor(error);
  } finally {
    busy.value = false;
  }
};

const rename = async (passkey) => {
  resetMessages();
  const name = await askFor({
    title: t('settings.passkeys.renameTitle'),
    label: t('settings.passkeys.renamePrompt'),
    value: passkey.name,
    confirmLabel: t('common.save'),
  });
  if (name === null) return;
  busy.value = true;
  try {
    await renamePasskey(passkey.id, name.trim());
    await refresh();
    successMsg.value = t('settings.passkeys.renamed');
  } catch (error) {
    errorMsg.value = error?.message || t('settings.passkeys.renameFailed');
  } finally {
    busy.value = false;
  }
};

const remove = async (passkey) => {
  resetMessages();
  busy.value = true;
  try {
    await deletePasskey(passkey.id, passwordValue.value);
    passwordValue.value = '';
    await refresh();
    successMsg.value = t('settings.passkeys.removed', { name: passkey.name });
  } catch (error) {
    errorMsg.value = error?.message || t('settings.passkeys.removeFailed');
  } finally {
    busy.value = false;
  }
};

const usedAt = (passkey) =>
  passkey.lastUsedAt
    ? t('settings.passkeys.lastUsed', { when: formatLocalDateTime(passkey.lastUsedAt) })
    : t('settings.passkeys.neverUsed');
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {{ t('settings.passkeys.title') }}
      </h2>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {{ isLocalUser ? t('settings.passkeys.intro') : t('settings.passkeys.notLocalUser') }}
      </p>
    </div>

    <div
      v-if="isLocalUser"
      class="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <div class="max-w-xl space-y-6">
        <p
          v-if="errorMsg"
          class="rounded-md bg-red-100 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400"
          data-test="passkeys-error"
        >
          {{ errorMsg }}
        </p>
        <p
          v-if="successMsg"
          class="rounded-md bg-green-100 p-4 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400"
          data-test="passkeys-success"
        >
          {{ successMsg }}
        </p>

        <!-- Nothing here can work without a secure page; say which, and why. -->
        <div
          v-if="!supported"
          class="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
          data-test="passkeys-unavailable"
        >
          <p class="text-sm font-medium text-amber-900 dark:text-amber-200">
            {{ t('settings.passkeys.unavailable') }}
          </p>
          <p class="text-xs text-amber-800 dark:text-amber-300">
            {{ t('settings.passkeys.unavailableHelp') }}
          </p>
        </div>

        <ul v-if="passkeys.length" class="divide-y divide-zinc-200 dark:divide-zinc-800">
          <li
            v-for="passkey in passkeys"
            :key="passkey.id"
            class="flex flex-wrap items-center justify-between gap-3 py-3"
            data-test="passkey"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {{ passkey.name }}
              </p>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                {{ t('settings.passkeys.addedOn', { when: formatLocalDateTime(passkey.createdAt) })
                }}<span> · </span>{{ usedAt(passkey) }}
                <span v-if="passkey.backedUp"> · {{ t('settings.passkeys.synced') }}</span>
              </p>
            </div>
            <div class="flex shrink-0 gap-2">
              <button
                type="button"
                :class="quietButtonClasses"
                :disabled="busy"
                data-test="passkey-rename"
                @click="rename(passkey)"
              >
                {{ t('settings.passkeys.rename') }}
              </button>
              <button
                type="button"
                :class="quietButtonClasses"
                :disabled="busy"
                data-test="passkey-remove"
                @click="remove(passkey)"
              >
                {{ t('settings.passkeys.remove') }}
              </button>
            </div>
          </li>
        </ul>
        <p v-else class="text-sm text-zinc-600 dark:text-zinc-300" data-test="passkeys-none">
          {{ t('settings.passkeys.none') }}
        </p>

        <!-- The password stands between an unlocked browser and a way in that
             somebody takes away. The same reason the second factor asks. -->
        <div v-if="passkeys.length" class="space-y-1">
          <label
            for="passkey-password"
            class="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
          >
            {{ t('settings.passkeys.confirmPassword') }}
          </label>
          <input
            id="passkey-password"
            v-model="passwordValue"
            type="password"
            autocomplete="current-password"
            :class="inputClasses"
            data-test="passkey-password"
          />
        </div>

        <div v-if="supported" class="space-y-2">
          <label
            for="passkey-name"
            class="block text-sm font-medium text-zinc-700 dark:text-zinc-200"
          >
            {{ t('settings.passkeys.nameLabel') }}
          </label>
          <div class="flex flex-wrap gap-2">
            <input
              id="passkey-name"
              v-model="newName"
              type="text"
              maxlength="60"
              :placeholder="t('settings.passkeys.namePlaceholder')"
              :class="[inputClasses, 'max-w-xs flex-1']"
              data-test="passkey-name"
            />
            <button
              type="button"
              :class="buttonClasses"
              :disabled="busy"
              data-test="passkey-add"
              @click="add"
            >
              {{ t('settings.passkeys.add') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
