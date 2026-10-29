/**
 * dsh-ui-visibility — client 半。
 *
 * 做两件事：
 *   1) 在「设置」里注册一个「界面管理」分区：列出 左侧边栏(sidebar.panellist) 与
 *      设置分区(settings.section) 的全部已注册条目，勾选=显示、取消=隐藏。
 *   2) 注入一段 CSS，按条目的 aria-label 把隐藏的那些藏起来。
 *
 * 为什么用 aria-label 而不是 data-id：宿主的 PanelRow 与设置行只渲染了
 * `aria-label={label}`（没有 data-id），详见 dsh-client-ui-sidebar / dsh-client-ui-settings-general。
 * 代价：**同名条目无法区分**，且隐藏只是看不见，插件本身仍在运行。
 */
window.__ModuleLoader__.load({
  id: 'dsh-ui-visibility',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const LS_KEY = 'dsh-ui-visibility:hidden:v1'
    const STYLE_ID = 'dsh-ui-visibility-style'
    const SELF_ID = 'dsh-ui-visibility'
    const SLOTS = [
      { slot: 'sidebar.panellist', title: '左侧边栏' },
      { slot: 'settings.section', title: '设置分区' },
    ]

    // ---------- 存储 ----------
    function readHidden() {
      try {
        const o = JSON.parse(window.localStorage.getItem(LS_KEY) || '{}')
        return o && typeof o === 'object' ? o : {}
      } catch (e) { return {} }
    }
    function writeHidden(o) {
      try { window.localStorage.setItem(LS_KEY, JSON.stringify(o)) } catch (e) { /* 忽略 */ }
    }

    // ---------- 标签解析（宿主用 resolveSlotLabel，这里按同样几种形态自己解）----------
    function labelOf(l) {
      if (typeof l === 'function') { try { return labelOf(l()) } catch (e) { return '' } }
      if (typeof l === 'string') return l
      if (l && typeof l === 'object') {
        return l.zh ?? l['zh-CN'] ?? l.en ?? Object.values(l)[0] ?? ''
      }
      return ''
    }
    function cssEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') }

    // ---------- 读槽位条目 ----------
    function entriesOf(ctx, slot) {
      try {
        if (typeof ctx.slots.entries === 'function') return ctx.slots.entries(slot) || []
        if (typeof ctx.slots.entriesOfSlot === 'function') return ctx.slots.entriesOfSlot(slot) || []
      } catch (e) { /* 忽略 */ }
      return []
    }

    // ---------- 生效：CSS（侧边栏）+ DOM 补丁（设置分区）----------
    //
    // 两个宿主的勾子不一样，必须分开处理：
    //   · sidebar.panellist 的 PanelRow 渲染了 `aria-label={label}` ⇒ 用 CSS 就够；
    //   · settings.section 的分区按钮**没有 aria-label**（只有 aria-current 和
    //     <span class="…navLabel">文本</span>）⇒ CSS 选不中，只能遍历 DOM 改行内样式。
    function paintCss(ctx) {
      const hidden = readHidden()
      const rules = []
      const hide = new Set(hidden['sidebar.panellist'] || [])
      if (hide.size) {
        for (const e of entriesOf(ctx, 'sidebar.panellist')) {
          const id = e?.options?.id
          if (!id || !hide.has(id)) continue
          const lb = labelOf(e?.options?.label)
          if (lb) rules.push(`[aria-label="${cssEsc(lb)}"]{display:none !important}`)
        }
      }
      let st = document.getElementById(STYLE_ID)
      if (!st) {
        st = document.createElement('style')
        st.id = STYLE_ID
        if (document.head) document.head.appendChild(st)
      }
      st.textContent = rules.join('\n')
    }

    /** 隐藏中的设置分区标签集合（按 label 文本） */
    function hiddenSectionLabels(ctx) {
      const hide = new Set((readHidden()['settings.section'] || []))
      const out = new Set()
      if (!hide.size) return out
      for (const e of entriesOf(ctx, 'settings.section')) {
        const id = e?.options?.id
        if (!id || !hide.has(id) || id === SELF_ID) continue
        const lb = labelOf(e?.options?.label)
        if (lb) out.add(lb)
      }
      return out
    }

    /** 设置弹层里的分区按钮：按文本匹配，命中就 display:none */
    function paintDom(ctx) {
      const targets = hiddenSectionLabels(ctx)
      let nodes
      try { nodes = document.querySelectorAll('button[class*="navCell"]') } catch (e) { return }
      for (const btn of nodes) {
        const txt = (btn.textContent || '').trim()
        if (targets.has(txt)) btn.style.display = 'none'
        else if (btn.style.display === 'none') btn.style.display = ''
      }
    }

    function paint(ctx) {
      try { paintCss(ctx) } catch (e) { /* 忽略 */ }
      try { paintDom(ctx) } catch (e) { /* 忽略 */ }
    }

    /** 设置弹层是打开时才挂进 DOM 的，所以要靠 MutationObserver 跟着补 */
    function watchDom(ctx) {
      try {
        const mo = new MutationObserver(() => paintDom(ctx))
        mo.observe(document.body || document.documentElement, { childList: true, subtree: true })
        ctx.effect?.(() => () => mo.disconnect())
        return mo
      } catch (e) { return null }
    }

    // ---------- 管理面板 ----------
    const CSS_PANEL = [
      '.uiv-root{padding:2px 0}',
      '.uiv-note{font-size:12px;opacity:.7;line-height:1.7;margin:0 0 12px}',
      '.uiv-bar{display:flex;gap:8px;margin-bottom:14px}',
      '.uiv-btn{font:inherit;font-size:12.5px;padding:5px 12px;border-radius:7px;cursor:pointer;',
      '  border:1px solid rgba(128,128,128,.35);background:rgba(128,128,128,.10);color:inherit}',
      '.uiv-btn:hover{background:rgba(128,128,128,.20)}',
      '.uiv-group{margin-bottom:18px}',
      '.uiv-gt{font-size:12px;font-weight:600;opacity:.75;margin-bottom:6px;letter-spacing:.04em}',
      '.uiv-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px}',
      '.uiv-row:hover{background:rgba(128,128,128,.10)}',
      '.uiv-row label{cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px}',
      '.uiv-id{font-family:ui-monospace,monospace;font-size:11px;opacity:.45}',
      '.uiv-empty{font-size:12px;opacity:.5;padding:4px 8px}',
      '.uiv-tag{font-size:10.5px;padding:1px 6px;border-radius:99px;opacity:.7;',
      '  border:1px solid rgba(128,128,128,.35)}',
    ].join('')

    function makeManager(ctx) {
      return function Manager() {
        const [hidden, setHidden] = useState(readHidden)
        const [ver, setVer] = useState(0)
        const refresh = useCallback(() => setVer((v) => v + 1), [])

        // 槽位有增删时重画列表
        useEffect(() => {
          const offs = []
          for (const t of SLOTS) {
            try { offs.push(ctx.slots.subscribe(t.slot, refresh)) } catch (e) { /* 忽略 */ }
          }
          return () => { for (const off of offs) { try { off && off() } catch (e) {} } }
        }, [refresh])

        const setOne = useCallback((slot, id, visible) => {
          const next = readHidden()
          const arr = new Set(next[slot] || [])
          if (visible) arr.delete(id)
          else arr.add(id)
          next[slot] = Array.from(arr)
          writeHidden(next)
          setHidden(next)
          paint(ctx)
        }, [ctx])

        const showAll = useCallback(() => {
          writeHidden({})
          setHidden({})
          paint(ctx)
        }, [ctx])

        const groups = SLOTS.map((t) => {
          const rows = entriesOf(ctx, t.slot)
            .map((e) => ({ id: e?.options?.id, label: labelOf(e?.options?.label) }))
            .filter((r) => r.id)
            .filter((r) => !(t.slot === 'settings.section' && r.id === SELF_ID))
            .sort((a, b) => a.label.localeCompare(b.label, 'zh'))
          return { ...t, rows }
        })

        const total = groups.reduce((s, g) => s + g.rows.length, 0)

        return h('div', { className: 'uiv-root' },
          h('style', null, CSS_PANEL),
          h('p', { className: 'uiv-note' },
            '勾选 = 显示，取消勾选 = 隐藏。共 ', String(total), ' 条。',
            h('br'),
            '隐藏只是「不显示」，插件本身仍在运行（工具、路由都还能用）。',
            h('br'),
            '同名条目按名字一起藏（宿主没给条目 id 留 DOM 钩子）。'
          ),
          h('div', { className: 'uiv-bar' },
            h('button', { className: 'uiv-btn', onClick: showAll }, '全部显示'),
            h('button', { className: 'uiv-btn', onClick: refresh }, '刷新列表')
          ),
          groups.map((g) =>
            h('div', { className: 'uiv-group', key: g.slot },
              h('div', { className: 'uiv-gt' }, `${g.title}（${g.rows.length}）`),
              g.rows.length === 0
                ? h('div', { className: 'uiv-empty' }, '（这个槽位还没有条目）')
                : g.rows.map((r) =>
                    h('div', { className: 'uiv-row', key: `${g.slot}:${r.id}` },
                      h('label', null,
                        h('input', {
                          type: 'checkbox',
                          checked: !(hidden[g.slot] || []).includes(r.id),
                          onChange: (ev) => setOne(g.slot, r.id, ev.target.checked),
                        }),
                        h('span', null, r.label || '(无标签)')
                      ),
                      h('span', { className: 'uiv-id' }, r.id)
                    )
                  )
            )
          )
        )
      }
    }

    // ---------- 插件 ----------
    function apply(ctx) {
      paint(ctx)
      watchDom(ctx)
      // 槽位变化时重画一次，保证新装的插件也能被正确隐藏
      for (const t of SLOTS) {
        try { ctx.slots.subscribe(t.slot, () => paint(ctx)) } catch (e) { /* 忽略 */ }
      }
      // 语言切换后重新解析 label
      try { ctx.locale?.subscribe?.(() => paint(ctx)) } catch (e) { /* 忽略 */ }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: SELF_ID, order: 90, label: '界面管理' },
          makeManager(ctx)
        )
      )
    }

    return { name: 'dsh-ui-visibility', inject: ['slots'], apply }
  },
})
