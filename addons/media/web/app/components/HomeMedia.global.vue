<script setup lang="ts">
/** Media's card on the home page */
const { data: m, refresh } = useMedia()
usePoll(refresh, 30000)
const downloading = computed(() => Object.values(m.value?.queues ?? {}).flat().filter((i: any) => i?.speed).length)
const vpnOk = computed(() => m.value?.vpn && m.value.vpn.up && m.value.vpn.killSwitch && !m.value.vpn.leaking)
const chips = computed(() => m.value
  ? [
      { text: vpnOk.value ? 'VPN ok' : 'VPN!', tone: vpnOk.value ? 'ok' : 'bad' },
      ...(downloading.value ? [{ text: `${downloading.value} ↓`, tone: 'accent' }] : []),
      { text: bytes(m.value.sizes?.used) },
    ]
  : [])
</script>

<template>
  <TopicCard to="/media" icon="media" name="Media" sub="VPN, downloads, library" :chips="chips" />
</template>
