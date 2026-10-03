import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import {
  getBranding as getBrandingApi,
  getSettings as getSettingsApi,
  patchSettings as patchSettingsApi,
  uploadLogo as uploadLogoApi,
} from '@/api';
import { useAuthStore } from '@/stores/auth';

export const useAppSettings = defineStore('appSettings', () => {
  const loaded = ref(false);
  const loading = ref(false);
  const loadedForUserId = ref(null);
  const lastError = ref(null);
  const authStore = useAuthStore();

  const createDefaultUserSettings = () => ({
    showHiddenFiles: false,
    showThumbnails: true,
    showSidebarFavorites: true,
    showSidebarShares: true,
    showSidebarTools: true,
    defaultShareExpiration: null,
    skipHome: null,
    folderSorts: {},
    folderViews: {},
    defaultView: null,
    // Folders first when sorting, as listing programs have always done. The
    // default keeps every list looking the way it did (#495).
    foldersFirst: true,
    // Markdown is the one kind of file with both a preview and an editor, so
    // it is the only one where opening it is a choice (#347).
    markdownOpensInEditor: false,
    // Opening a document in a browser tab of its own, rather than over the
    // folder it is in. Off, so nothing changes for anybody who does not ask
    // for it.
    documentsOpenInNewTab: false,
    // The small mark on a row whose file has earlier versions. On, unlike the
    // two above: it says something true about the file that nothing else in
    // the listing says, and a history nobody knows about is a history nobody
    // uses. It is read as `!== false` on the server, so this default and that
    // one cannot drift apart.
    showVersionMarks: true,
    // The language this account is read in. null follows the browser, which is
    // what everybody got before there was anywhere to say otherwise.
    locale: null,
    // What a selection of several things becomes on the way out. `zip` is what
    // every version until now did, so nobody's downloads change shape until
    // they ask for it (#487).
    downloadMode: 'zip',
  });

  const createDefaultTrashSettings = () => ({
    enabled: true,
    retentionDays: 30,
    maxPercent: 10,
    maxBytes: null,
  });

  const createDefaultVersionSettings = () => ({
    enabled: true,
    keepAllHours: 24,
    hourlyDays: 7,
    dailyDays: 30,
    maxPerFile: 50,
    sessionCheckpointMinutes: 10,
  });

  const createDefaultSystemSettings = () => ({
    thumbnails: { enabled: true, size: 200, quality: 70, concurrency: 10 },
    ffmpeg: { ffmpegPath: null, ffprobePath: null },
    access: { rules: [] },
    uploads: { chunkedEnabled: false, chunkSizeBytes: 8 * 1024 * 1024 },
    folderSize: { excludedPaths: [], environmentExcludedPaths: [] },
    searchIndex: { excludedPaths: [], environmentExcludedPaths: [] },
    trash: createDefaultTrashSettings(),
    versions: createDefaultVersionSettings(),
    // Off until an administrator asks for it, which is what the server says
    // too: a page that starts by showing the switch on would be a lie.
    activity: { enabled: false, retentionDays: 90 },
  });

  // Three-tier settings structure
  const publicSettings = ref({
    branding: { appName: 'Explorer', appLogoUrl: '/logo.svg', showPoweredBy: false },
  });

  const userSettings = ref(createDefaultUserSettings());
  const systemSettings = ref(createDefaultSystemSettings());

  // Signing in as someone else must not leave the previous account's
  // preferences on screen, so the store empties itself the moment the user
  // changes rather than waiting for the next load to overwrite it.
  watch(
    () => authStore.currentUser?.id ?? null,
    (userId, previousUserId) => {
      if (userId === previousUserId) return;

      loaded.value = false;
      loadedForUserId.value = null;
      userSettings.value = createDefaultUserSettings();
      systemSettings.value = createDefaultSystemSettings();
    },
    { flush: 'sync' }
  );

  // Computed state that combines all settings (for backward compatibility)
  const state = computed(() => ({
    branding: publicSettings.value.branding,
    user: userSettings.value,
    thumbnails: systemSettings.value.thumbnails,
    ffmpeg: systemSettings.value.ffmpeg,
    access: systemSettings.value.access,
    uploads: systemSettings.value.uploads,
    folderSize: systemSettings.value.folderSize,
    searchIndex: systemSettings.value.searchIndex,
  }));

  // Whether thumbnails should be shown/requested for the current session.
  // - System toggle (admin) applies globally when known.
  // - User preference applies only when a user is authenticated.
  // - When settings aren't loaded (e.g. guest/share sessions), fail open and rely on
  //   backend-provided `supportsThumbnail` + thumbnail endpoint behavior.
  const thumbnailsEnabledForSession = computed(() => {
    if (loaded.value && systemSettings.value?.thumbnails?.enabled === false) {
      return false;
    }

    const hasUser = Boolean(authStore.currentUser);
    if (loaded.value && hasUser && userSettings.value?.showThumbnails === false) {
      return false;
    }

    return true;
  });

  // Load public branding (no auth required) - can be called on login page
  const loadBranding = async () => {
    lastError.value = null;
    try {
      const b = await getBrandingApi();
      publicSettings.value.branding = {
        appName: 'Explorer',
        appLogoUrl: '/logo.svg',
        showPoweredBy: false,
        ...(b || {}),
      };
    } catch (e) {
      console.debug('Failed to load branding:', e?.message || 'Unknown error');
      // Don't set lastError for branding - it's not critical
    }
  };

  // Load settings based on user role
  // - No auth: branding only
  // - Authenticated user: branding + user settings
  // - Admin: branding + user settings + system settings
  const load = async () => {
    const userId = authStore.currentUser?.id ?? null;
    loading.value = true;
    lastError.value = null;
    try {
      const s = await getSettingsApi();

      // Always update branding (public)
      if (s?.branding) {
        publicSettings.value.branding = {
          appName: 'Explorer',
          appLogoUrl: '/logo.svg',
          showPoweredBy: false,
          ...s.branding,
        };
      }

      // Update user settings if present (authenticated users)
      if (userId === authStore.currentUser?.id && s?.user && typeof s.user === 'object') {
        userSettings.value = {
          ...createDefaultUserSettings(),
          ...s.user,
        };
      }

      // Update system settings if present (admin only)
      if (userId === authStore.currentUser?.id && s?.thumbnails) {
        systemSettings.value.thumbnails = {
          enabled: true,
          size: 200,
          quality: 70,
          ...s.thumbnails,
        };
      }
      if (userId === authStore.currentUser?.id && s?.ffmpeg) {
        systemSettings.value.ffmpeg = {
          ffmpegPath: null,
          ffprobePath: null,
          ...s.ffmpeg,
        };
      }
      if (userId === authStore.currentUser?.id && s?.access) {
        systemSettings.value.access = {
          rules: Array.isArray(s.access.rules) ? s.access.rules : [],
        };
      }
      if (s?.uploads) {
        systemSettings.value.uploads = {
          chunkedEnabled: false,
          chunkSizeBytes: 8 * 1024 * 1024,
          ...s.uploads,
        };
      }
      if (s?.folderSize) {
        systemSettings.value.folderSize = {
          excludedPaths: [],
          environmentExcludedPaths: [],
          ...s.folderSize,
        };
      }
      if (s?.searchIndex) {
        systemSettings.value.searchIndex = {
          excludedPaths: [],
          environmentExcludedPaths: [],
          ...s.searchIndex,
        };
      }
      if (s?.trash) {
        systemSettings.value.trash = { ...createDefaultTrashSettings(), ...s.trash };
      }
      if (s?.versions) {
        systemSettings.value.versions = { ...createDefaultVersionSettings(), ...s.versions };
      }
      if (s?.activity) {
        systemSettings.value.activity = { enabled: false, retentionDays: 90, ...s.activity };
      }

      if (userId === authStore.currentUser?.id) {
        loadedForUserId.value = userId;
        loaded.value = true;
      }
    } catch (e) {
      // For non-admin users, 403 errors are expected for system settings
      // But we should still have branding loaded
      const authStore = useAuthStore();
      const isAdmin =
        authStore.currentUser &&
        Array.isArray(authStore.currentUser?.roles) &&
        authStore.currentUser.roles.includes('admin');

      if (!isAdmin && e?.status === 403) {
        // Non-admin user - this is expected, just ensure branding is loaded
        await loadBranding();
        if (userId === authStore.currentUser?.id) {
          loadedForUserId.value = userId;
          loaded.value = true;
        }
      } else {
        lastError.value = e?.message || 'Failed to load settings';
      }
    } finally {
      loading.value = false;
    }
  };

  const ensureLoaded = async () => {
    const userId = authStore.currentUser?.id ?? null;
    if (loaded.value && loadedForUserId.value === userId) {
      return state.value;
    }
    await load();
    return state.value;
  };

  /**
   * Send a change and keep what the server answered, for as long as the
   * person who sent it is still the one signed in.
   */
  const saveWith = async (send) => {
    const userId = authStore.currentUser?.id ?? null;
    lastError.value = null;
    try {
      const updated = await send();

      // Update local state based on what was returned
      if (userId !== authStore.currentUser?.id) {
        return state.value;
      }

      if (updated?.branding) {
        publicSettings.value.branding = {
          appName: 'Explorer',
          appLogoUrl: '/logo.svg',
          showPoweredBy: false,
          ...updated.branding,
        };
      }

      if (updated?.user) {
        userSettings.value = {
          ...userSettings.value,
          ...updated.user,
        };
      }

      if (updated?.thumbnails) {
        systemSettings.value.thumbnails = {
          enabled: true,
          size: 200,
          quality: 70,
          ...updated.thumbnails,
        };
      }
      if (updated?.ffmpeg) {
        systemSettings.value.ffmpeg = {
          ffmpegPath: null,
          ffprobePath: null,
          ...updated.ffmpeg,
        };
      }

      if (updated?.access) {
        systemSettings.value.access = {
          rules: Array.isArray(updated.access.rules) ? updated.access.rules : [],
        };
      }
      if (updated?.folderSize) {
        systemSettings.value.folderSize = {
          excludedPaths: [],
          environmentExcludedPaths: [],
          ...updated.folderSize,
        };
      }
      // Copied here as `load` copies it. It was not, so a saved exclusion list
      // left the store holding the old one and the page still "unsaved".
      if (updated?.searchIndex) {
        systemSettings.value.searchIndex = {
          excludedPaths: [],
          environmentExcludedPaths: [],
          ...updated.searchIndex,
        };
      }

      if (updated?.uploads) {
        systemSettings.value.uploads = {
          chunkedEnabled: false,
          chunkSizeBytes: 8 * 1024 * 1024,
          ...updated.uploads,
        };
      }

      if (updated?.trash) {
        systemSettings.value.trash = { ...createDefaultTrashSettings(), ...updated.trash };
      }
      if (updated?.versions) {
        systemSettings.value.versions = {
          ...createDefaultVersionSettings(),
          ...updated.versions,
        };
      }
      if (updated?.activity) {
        systemSettings.value.activity = { enabled: false, retentionDays: 90, ...updated.activity };
      }

      loaded.value = true;
      loadedForUserId.value = userId;
      return state.value;
    } catch (e) {
      lastError.value = e?.message || 'Failed to save settings';
      throw e;
    }
  };

  const save = (partial) => saveWith(() => patchSettingsApi(partial));

  // The logo and the rest of the branding go in one request, so that a logo is
  // never stored without the name saved alongside it, or the other way round.
  const saveLogo = (file, branding) => saveWith(() => uploadLogoApi(file, branding));

  return {
    state,
    publicSettings,
    userSettings,
    systemSettings,
    loaded,
    loading,
    lastError,
    thumbnailsEnabledForSession,
    load,
    ensureLoaded,
    loadBranding,
    save,
    saveLogo,
  };
});
