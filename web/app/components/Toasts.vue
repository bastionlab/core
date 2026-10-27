<script setup lang="ts">
const { toasts, close } = useToast()
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.tone">
        <span class="txt">{{ t.text }}</span>
        <button v-if="t.action" type="button" class="lnk" @click="t.action.fn(); close(t.id)">{{ t.action.label }}</button>
        <button type="button" class="btn ghost sm" aria-label="Close" @click="close(t.id)"><Icon name="x" :size="16"/></button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed; z-index: 80; left: 50%; transform: translateX(-50%); bottom: 18px;
  display: flex; flex-direction: column; gap: 6px; width: min(440px, calc(100vw - 24px)); pointer-events: none;
}
.toast {
  display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 14px; pointer-events: auto;
  background: var(--panel-2); border: 1px solid var(--line-2); border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgb(0 0 0 / .45);
}
.toast.ok { border-left: 3px solid var(--ok); }
.toast.bad { border-left: 3px solid var(--bad); }
.toast.warn { border-left: 3px solid var(--warn); }
.txt { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.toast-enter-active, .toast-leave-active { transition: opacity .2s, transform .2s; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
@media (max-width: 640px) { .toasts { bottom: calc(var(--tabbar) + 10px); } }
</style>
