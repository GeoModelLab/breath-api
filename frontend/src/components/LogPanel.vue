<template>
  <div class="panel log-panel">
    <div class="flex items-center justify-between">
      <h2>Model Log</h2>
      <div class="flex gap-2 items-center">
        <span class="text-xs text-muted">{{ lines.length }} lines</span>
        <button class="btn-ghost text-xs" @click="clear">Clear</button>
      </div>
    </div>
    <div ref="logBox" class="log-box">
      <div v-if="!lines.length" class="log-empty">No output yet.</div>
      <div v-for="(line, i) in lines" :key="i" :class="lineClass(line)" class="log-line">
        {{ line }}
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'LogPanel',

  data() {
    return { lines: [] }
  },

  methods: {
    append(msg) {
      if (!msg?.trim()) return
      this.lines.push(msg)
      this.$nextTick(() => {
        const box = this.$refs.logBox
        if (box) box.scrollTop = box.scrollHeight
      })
    },

    clear() { this.lines = [] },

    lineClass(line) {
      if (line.includes('ERROR') || line.includes('❌')) return 'log-error'
      if (line.includes('✅') || line.includes('complete'))  return 'log-success'
      if (line.includes('⚠️') || line.includes('WARNING'))  return 'log-warn'
      if (line.includes('🛰️') || line.includes('☀️') || line.includes('📈')) return 'log-info'
      return ''
    },
  },
}
</script>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.log-box {
  flex: 1;
  overflow-y: auto;
  margin-top: 8px;
  background: #0a0d14;
  border-radius: 6px;
  padding: 8px 10px;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 11px;
  line-height: 1.7;
  min-height: 80px;
}

.log-empty { color: #334155; }

.log-line   { color: #94a3b8; white-space: pre-wrap; word-break: break-all; }
.log-error  { color: #f87171; }
.log-success{ color: #4ade80; }
.log-warn   { color: #fbbf24; }
.log-info   { color: #60a5fa; }
</style>
