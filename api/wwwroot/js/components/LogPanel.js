;(function() {
const { defineComponent } = Vue

window.LogPanel = defineComponent({
  name: 'LogPanel',
  data() { return { lines: [] } },

  methods: {
    append(msg) {
      if (!msg?.trim()) return
      const text = msg.trim()
      const cls = /ERROR|❌/.test(text)                             ? 'log-err'
                : /✅|complete|done|📊/i.test(text)                 ? 'log-ok'
                : /⚠️|WARNING/i.test(text)                          ? 'log-warn'
                : /🛰️|☀️|📈|📂|⚙️|▶|Running|🚀|📍|🔬/i.test(text) ? 'log-info'
                : 'log-line'
      this.lines.push({ text, cls })
      if (this.lines.length > 200) this.lines.shift()
      this.$nextTick(() => {
        const el = this.$el?.querySelector('.log-body')
        if (el) el.scrollTop = el.scrollHeight
      })
    },
    clear() { this.lines = [] },
  },

  template: `
    <div class="log-panel">
      <div class="log-hd">
        <span class="log-hd-icon">📋</span>
        <span class="log-hd-title">Log</span>
        <span class="log-count" v-if="lines.length">{{ lines.length }}</span>
        <button class="log-clear-btn" v-if="lines.length" @click="clear" title="Clear log">✕</button>
      </div>
      <div class="log-body">
        <div v-if="!lines.length" class="log-empty">Ready</div>
        <div v-for="(l,i) in lines" :key="i" :class="['log-line-item', l.cls]">{{ l.text }}</div>
      </div>
    </div>
  `,
})
})()
