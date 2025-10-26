<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSettingsStore } from '@/stores/settings';
import { useAuthStore } from '@/stores/auth';
import {
  ArrowRightOnRectangleIcon,
  Cog8ToothIcon,
  UserCircleIcon,
} from '@heroicons/vue/24/outline';

import { SunIcon, MoonIcon } from '@heroicons/vue/24/outline';

const settings = useSettingsStore();
const auth = useAuthStore();
const router = useRouter();

const isAccountMenuOpen = ref(false);
const avatarButtonRef = ref(null);
const menuRef = ref(null);

const displayName = computed(() => auth.currentUser?.displayName || auth.currentUser?.username || 'Account');
const secondaryLabel = computed(() => {
  if (auth.currentUser?.email) {
    return auth.currentUser.email;
  }
  if (auth.currentUser?.username) {
    return auth.currentUser.username;
  }
  return '';
});

const avatarLetter = computed(() => {
  const source = auth.currentUser?.displayName || auth.currentUser?.username || '';
  return source ? source.trim().charAt(0).toUpperCase() : '';
});

const closeMenu = () => {
  isAccountMenuOpen.value = false;
};

const toggleMenu = () => {
  isAccountMenuOpen.value = !isAccountMenuOpen.value;
};

const handleDocumentClick = (event) => {
  if (!isAccountMenuOpen.value) {
    return;
  }

  const path = event.composedPath ? event.composedPath() : event.path || [];
  if (
    (avatarButtonRef.value && path.includes(avatarButtonRef.value))
    || (menuRef.value && path.includes(menuRef.value))
  ) {
    return;
  }

  closeMenu();
};

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
});

const handleSettings = () => {
  closeMenu();
  router.push({ path: '/settings' });
};

const handleLogout = async () => {
  await auth.logout();
  closeMenu();
  router.push({ name: 'auth-login' });
};
</script>

<template>

  <div class="flex items-center gap-1">

    <button title="toggle dark mode" @click="settings.toggleDark()"
      class="p-[6px] rounded-md dark:hover:bg-zinc-700 dark:active:bg-zinc-600">
      <SunIcon class="w-6" v-if="settings.isDark" />
      <MoonIcon class="w-6" v-else />
    </button>

    <div class="relative">
      <button
        ref="avatarButtonRef"
        title="Account"
        class="flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent transition hover:bg-accent/25 dark:bg-white/10 dark:text-white dark:hover:bg-white/20"
        @click.stop="toggleMenu"
      >
        <span v-if="avatarLetter" class="text-sm font-semibold uppercase">{{ avatarLetter }}</span>
        <UserCircleIcon v-else class="h-6 w-6" />
      </button>

      <transition name="fade">
        <div
          v-if="isAccountMenuOpen"
          ref="menuRef"
          class="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-white/10 bg-nextzinc-900/95 p-4 text-sm shadow-xl shadow-black/40 backdrop-blur"
        >
          <div class="mb-3">
            <p class="text-base font-semibold text-white">{{ displayName }}</p>
            <p v-if="secondaryLabel" class="text-xs text-white/60 truncate">{{ secondaryLabel }}</p>
          </div>

          <div class="space-y-1">
            <button
              class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-white/80 transition hover:bg-white/10 hover:text-white"
              type="button"
              @click="handleSettings"
            >
              <Cog8ToothIcon class="h-5 w-5" />
              <span>Settings</span>
            </button>

            <button
              class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-red-300 transition hover:bg-red-500/10 hover:text-red-200"
              type="button"
              @click="handleLogout"
            >
              <ArrowRightOnRectangleIcon class="h-5 w-5" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </transition>
    </div>

  </div>

</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.fade-enter-to,
.fade-leave-from {
  opacity: 1;
  transform: translateY(0);
}
</style>
