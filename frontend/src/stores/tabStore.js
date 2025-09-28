import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { normalizePath } from '@/api';

let nextId = 1;
const createId = () => `tab-${nextId++}`;

const computeLabel = (path) => {
  if (!path) {
    return 'Volumes';
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) {
    return 'Volumes';
  }
  return segments[segments.length - 1];
};

export const useTabStore = defineStore('tabStore', () => {
  const tabs = ref([]);
  const activeTabId = ref(null);

  const findTabIndex = (id) => tabs.value.findIndex((tab) => tab.id === id);
  const findTabById = (id) => tabs.value.find((tab) => tab.id === id) || null;
  const findTabByPath = (path) => tabs.value.find((tab) => tab.path === path) || null;

  const activeTab = computed(() => findTabById(activeTabId.value));

  const tabList = computed(() => tabs.value.map((tab) => ({
    ...tab,
    label: computeLabel(tab.path),
  })));

  const ensureActiveTabExists = () => {
    if (tabs.value.length === 0) {
      const tab = { id: createId(), path: '' };
      tabs.value.push(tab);
      activeTabId.value = tab.id;
      return tab;
    }
    if (!activeTab.value) {
      activeTabId.value = tabs.value[0].id;
    }
    return activeTab.value;
  };

  const openTab = (path, options = {}) => {
    const normalized = normalizePath(path || '');
    const tabId = options.id || createId();
    const allowDuplicate = Boolean(options.allowDuplicate);

    let existingById = findTabById(tabId);
    if (existingById) {
      existingById.path = normalized;
      activeTabId.value = existingById.id;
      return existingById;
    }

    if (!allowDuplicate) {
      const existingByPath = findTabByPath(normalized);
      if (existingByPath) {
        activeTabId.value = existingByPath.id;
        return existingByPath;
      }
    }

    const tab = { id: tabId, path: normalized };
    tabs.value.push(tab);
    activeTabId.value = tab.id;
    return tab;
  };

  const updateTabPath = (id, path) => {
    const tab = findTabById(id);
    if (!tab) return;
    tab.path = normalizePath(path || '');
  };

  const setActiveTab = (id) => {
    if (!findTabById(id)) return;
    activeTabId.value = id;
  };

  const ensureActiveTabPath = (path) => {
    const normalized = normalizePath(path || '');
    const active = ensureActiveTabExists();
    if (!active) return;
    active.path = normalized;
  };

  const closeTab = (id) => {
    const index = findTabIndex(id);
    if (index === -1) {
      return { removed: null, nextTab: activeTab.value };
    }

    const [removed] = tabs.value.splice(index, 1);

    if (tabs.value.length === 0) {
      activeTabId.value = null;
      return { removed, nextTab: null };
    }

    if (activeTabId.value === id) {
      const nextIndex = index > 0 ? index - 1 : 0;
      const nextTab = tabs.value[nextIndex] || tabs.value[0];
      activeTabId.value = nextTab.id;
      return { removed, nextTab };
    }

    return { removed, nextTab: findTabById(activeTabId.value) };
  };

  const clear = () => {
    tabs.value = [];
    activeTabId.value = null;
  };

  return {
    tabs,
    tabList,
    activeTabId,
    activeTab,
    openTab,
    updateTabPath,
    setActiveTab,
    ensureActiveTabPath,
    closeTab,
    clear,
    findTabById,
    findTabByPath,
  };
});
