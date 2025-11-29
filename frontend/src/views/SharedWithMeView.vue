<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { getSharedWithMe } from '@/api/shares.api';
import {
  ShareIcon,
  FolderIcon,
  DocumentIcon,
  ClockIcon,
  LockClosedIcon,
  LockOpenIcon,
  UserIcon,
  ArrowRightIcon,
} from '@heroicons/vue/24/outline';

const router = useRouter();
const shares = ref([]);
const loading = ref(false);
const error = ref('');

const loadShares = async () => {
  loading.value = true;
  error.value = '';

  try {
    const response = await getSharedWithMe();
    shares.value = response.shares || [];
  } catch (err) {
    console.error('Failed to load shared items:', err);
    error.value = err.message || 'Failed to load shared items';
  } finally {
    loading.value = false;
  }
};

const getShareLabel = (share) => {
  if (share.label) {
    return share.label;
  }
  // Fallback to last part of source path
  const parts = share.sourcePath?.split('/').filter(Boolean);
  return parts?.[parts.length - 1] || 'Shared Item';
};

const formatDate = (dateString) => {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
};

const isExpired = (share) => {
  if (!share.expiresAt) return false;
  return new Date(share.expiresAt) < new Date();
};

const handleOpenShare = (share) => {
  if (isExpired(share)) return;

  router.push({
    name: 'FolderView',
    params: { path: `share/${share.shareToken}` }
  });
};

onMounted(async () => {
  await loadShares();
});
</script>

<template>
  <div class="h-full flex flex-col bg-base">
    <!-- Header -->
    <div class="border-b border-neutral-200 dark:border-neutral-800 px-6 py-4">
      <div class="flex items-center gap-3">
        <ShareIcon class="w-6 h-6 text-neutral-600 dark:text-neutral-400" />
        <h1 class="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
          Shared With Me
        </h1>
      </div>
      <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Files and folders that have been shared with you
      </p>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto px-6 py-6">
      <!-- Loading State -->
      <div v-if="loading" class="flex items-center justify-center py-12">
        <div class="text-center">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p class="text-neutral-600 dark:text-neutral-400">Loading shares...</p>
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="flex items-center justify-center py-12">
        <div class="text-center max-w-md">
          <div class="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShareIcon class="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            Failed to Load Shares
          </h3>
          <p class="text-neutral-600 dark:text-neutral-400 mb-4">{{ error }}</p>
          <button
            @click="loadShares"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
          >
            Try Again
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else-if="!shares.length" class="flex items-center justify-center py-12">
        <div class="text-center max-w-md">
          <div class="w-16 h-16 bg-neutral-100 dark:bg-neutral-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShareIcon class="w-8 h-8 text-neutral-400 dark:text-neutral-500" />
          </div>
          <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-2">
            No Shared Items
          </h3>
          <p class="text-neutral-600 dark:text-neutral-400">
            When someone shares files or folders with you, they will appear here.
          </p>
        </div>
      </div>

      <!-- Shares Grid -->
      <div v-else class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <div
          v-for="share in shares"
          :key="share.id"
          @click="handleOpenShare(share)"
          class="group relative bg-white dark:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 p-4 hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-600 transition-all duration-200"
          :class="{
            'cursor-pointer': !isExpired(share),
            'opacity-50 cursor-not-allowed': isExpired(share)
          }"
        >
          <!-- Icon & Type -->
          <div class="flex items-start gap-3 mb-3">
            <div class="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center"
              :class="share.isDirectory ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-neutral-100 dark:bg-neutral-700'">
              <component
                :is="share.isDirectory ? FolderIcon : DocumentIcon"
                class="w-6 h-6"
                :class="share.isDirectory ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-600 dark:text-neutral-400'"
              />
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="font-medium text-neutral-900 dark:text-neutral-100 truncate">
                {{ getShareLabel(share) }}
              </h3>
              <p class="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
                {{ share.isDirectory ? 'Folder' : 'File' }}
              </p>
            </div>
          </div>

          <!-- Details -->
          <div class="space-y-2 text-xs text-neutral-600 dark:text-neutral-400">
            <!-- Shared By -->
            <div class="flex items-center gap-2">
              <UserIcon class="w-4 h-4 flex-shrink-0" />
              <span class="truncate">Shared by owner</span>
            </div>

            <!-- Access Mode -->
            <div class="flex items-center gap-2">
              <component
                :is="share.accessMode === 'readonly' ? LockClosedIcon : LockOpenIcon"
                class="w-4 h-4 flex-shrink-0"
              />
              <span>{{ share.accessMode === 'readonly' ? 'Read Only' : 'Read & Write' }}</span>
            </div>

            <!-- Expiry -->
            <div v-if="share.expiresAt" class="flex items-center gap-2">
              <ClockIcon class="w-4 h-4 flex-shrink-0" />
              <span class="truncate" :class="{ 'text-red-600 dark:text-red-400': isExpired(share) }">
                {{ isExpired(share) ? 'Expired' : 'Expires' }} {{ formatDate(share.expiresAt) }}
              </span>
            </div>
            <div v-else class="flex items-center gap-2">
              <ClockIcon class="w-4 h-4 flex-shrink-0" />
              <span>No expiration</span>
            </div>
          </div>

          <!-- Access Button (on hover) -->
          <div
            v-if="!isExpired(share)"
            class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <div class="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
              <ArrowRightIcon class="w-4 h-4 text-white" />
            </div>
          </div>

          <!-- Expired Badge -->
          <div
            v-if="isExpired(share)"
            class="absolute top-2 right-2 px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-xs font-medium rounded"
          >
            Expired
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
