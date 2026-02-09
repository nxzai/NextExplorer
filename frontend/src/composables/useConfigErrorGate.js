import { onMounted, ref } from 'vue';
import { useFeaturesStore } from '@/stores/features';

export function useConfigErrorGate() {
  const features = useFeaturesStore();
  const configError = ref(null); // { mode: 'mismatch'|'error', expectedOrigin, requestOrigin }

  onMounted(async () => {
    const requestOrigin = window.location.origin;
    try {
      await features.ensureLoaded();
      const expectedOrigin = features.publicOrigin || '';
      if (expectedOrigin && expectedOrigin !== requestOrigin) {
        configError.value = { mode: 'mismatch', expectedOrigin, requestOrigin };
      }
    } catch (_) {
      configError.value = { mode: 'error', expectedOrigin: '', requestOrigin };
    }
  });

  return { configError };
}

