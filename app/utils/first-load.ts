import { computed, ref, watchEffect, type ComputedRef, type Ref } from 'vue'

type FetchStatus = 'idle' | 'pending' | 'success' | 'error'

// Not `status === 'pending'`: useAsyncData flips back to pending on every refresh,
// and the Dashboard refreshes every 5s, so that would blink skeletons over data.
export function isFirstLoad(...statuses: Ref<FetchStatus>[]): ComputedRef<boolean> {
  const settled = ref(false)
  watchEffect(() => {
    if (statuses.every((s) => s.value === 'success' || s.value === 'error')) settled.value = true
  })
  return computed(() => !settled.value && statuses.some((s) => s.value !== 'success'))
}
