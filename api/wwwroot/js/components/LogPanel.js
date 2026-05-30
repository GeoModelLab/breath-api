;(function() {
const { defineComponent } = Vue

window.LogPanel = defineComponent({
  name: 'LogPanel',
  data() { return { lines: [], _flash: false } },

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
      if (this.lines.length > 500) this.lines.shift()
      // Flash animation on new line
      this._flash = false
      this.$nextTick(() => { this._flash = true })
    },
    clear() { this.lines = [] },
  },

  computed: {
    last() { return this.lines[this.lines.length - 1] ?? null },
    // Condensed recent history (shown on hover / expansion)
    recent() { return this.lines.slice(-6) },
  },

  template: `
    <div class="log-status" :title="recent.map(l=>l.text).join('\\n')">
      <span class="log-status-icon">{{ last?.cls === 'log-ok'   ? '✅'
                                     : last?.cls === 'log-err'  ? '❌'
                                     : last?.cls === 'log-warn' ? '⚠️'
                                     : last?.cls === 'log-info' ? '●'
                                     : last ? '○' : '—' }}</span>
      <span v-if="last" :class="['log-status-text', last.cls, _flash && 'log-flash']"
            :key="lines.length">
        {{ last.text.length > 80 ? last.text.slice(0,78) + '…' : last.text }}
      </span>
      <span v-else class="log-status-text log-line">Ready</span>
      <span v-if="lines.length > 1" class="log-count">{{ lines.length }}</span>
    </div>
  `,
})
})()
