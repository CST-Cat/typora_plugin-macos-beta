const PROVIDER_TIMEOUT = 2500
const RECENT_FILES_LIMIT = 120

const resolveWithTimeout = (producer, fallback, label, timeout = PROVIDER_TIMEOUT) => new Promise(resolve => {
  let done = false
  const timer = setTimeout(() => {
    if (done) return
    done = true
    console.warn(`[Command Palette] ${label} timed out`)
    resolve(fallback)
  }, timeout)

  Promise.resolve()
    .then(producer)
    .then(
      result => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(result)
      },
      error => {
        if (done) return
        done = true
        clearTimeout(timer)
        console.error(`[Command Palette] ${label} failed:`, error)
        resolve(fallback)
      },
    )
})

const makeFileItem = (utils, file, isFolder = false) => {
  if (!file) return null
  return {
    title: file,
    action: () => isFolder ? utils.openFolder(file) : utils.openFile(file),
  }
}

const uniqueItems = (items) => {
  const seen = new Set()
  return items.filter(item => {
    if (!item?.title || seen.has(item.title)) return false
    seen.add(item.title)
    return true
  })
}

const buildProviders = (utils, context) => {
  const t = (key, fallback, variables) => {
    const translated = context.t?.(key, variables)
    return translated && translated !== key ? translated : fallback
  }

  return [
  {
    prefix: "",
    name: "Tabs",
    fetch: async () => {
      const manager = utils.getBasePlugin("window_tab")?.tab
      return (manager?.tabs || []).map(t => ({ title: t.path, action: () => manager.switchByPath(t.path) }))
    },
  },
  {
    prefix: "#",
    name: "Recent Files",
    fetch: async () => {
      const { files, folders } = await resolveWithTimeout(
        () => utils.getRecentFiles(),
        { files: [], folders: [] },
        "Recent files provider",
        3500,
      )
      const current = utils.getFilePath()
      const mapEntity = (isFolder) => (ent) => {
        if (!ent.path || ent.path === current) return null
        return makeFileItem(utils, ent.path, isFolder)
      }
      const folderEnts = (folders || []).map(mapEntity(true))
      const fileEnts = (files || []).map(mapEntity(false))
      return uniqueItems([...folderEnts, ...fileEnts].filter(Boolean))
        .filter(item => item.title !== current)
        .slice(0, RECENT_FILES_LIMIT)
    },
  },
  {
    prefix: ">",
    name: "Plugins",
    fetch: async () => {
      const anchor = context.getAnchor()
      const plugins = Object.entries(utils.getAllBasePlugins()).filter(([_, p]) => p.call)
      return plugins.flatMap(([fixedName, plugin]) => {
        try {
          const staticActions = plugin.staticActions || []
          const dynamicActions = utils.updatePluginDynamicActions(fixedName, anchor, true) || []
          const actions = [...staticActions, ...dynamicActions].filter(act => !act.act_disabled && !act.act_hidden)
          if (actions.length === 0) {
            return [{ title: `${plugin.pluginName} ( ${fixedName} )`, action: () => utils.updateAndCallPluginDynamicAction(fixedName, undefined, anchor) }]
          }
          return actions.map(act => ({
            title: `${plugin.pluginName} - ${act.act_name} ( ${fixedName} - ${act.act_value} )`,
            action: () => utils.updateAndCallPluginDynamicAction(fixedName, act.act_value, anchor),
          }))
        } catch (error) {
          console.error(`[Command Palette] Plugin provider failed for ${fixedName}:`, error)
          return []
        }
      })
    },
  },
  {
    prefix: ">",
    name: "Commands",
    fetch: async () => {
      const doExport = async (name) => {
        const [htmlLike, others] = JSON.parse(await JSBridge.invoke("setting.loadExports"))
        ClientCommand.export(htmlLike[name])
      }
      const outlineView = () => {
        File.editor.library.toggleSidebar()
        if (File.isNode) ClientCommand.refreshViewMenu()
      }
      const themes = await resolveWithTimeout(
        () => JSBridge.invoke("setting.getThemes"),
        { all: [] },
        "Theme provider",
        500,
      )
      const allThemes = Array.isArray(themes?.all) ? themes.all : []
      return [
        { title: t("command.showInFinder", "Show in Finder"), action: () => utils.showInFinder(utils.getFilePath()) },
        { title: t("command.openFileInNewWindow", "Open File In New Window"), action: () => File.editor.library.openFileInNewWindow(utils.getFilePath(), false) },
        { title: t("command.copyFilePath", "Copy File Path"), action: () => File.editor.UserOp.setClipboard(null, null, utils.getFilePath()) },
        { title: t("command.togglePreferencePanel", "Toggle Preference Panel"), action: () => File.megaMenu.togglePreferencePanel() },
        { title: t("command.togglePinWindow", "Toggle Pin Window"), action: () => ClientCommand[document.body.classList.contains("always-on-top") ? "unpinWindow" : "pinWindow"]() },
        { title: t("command.openSettingFolder", "Open Setting Folder"), action: () => utils.settings.openFolder() },
        { title: t("command.print", "Print"), action: () => ClientCommand.print() },
        { title: t("command.exportHtml", "Export: HTML"), action: () => doExport("html") },
        { title: t("command.exportHtmlPlain", "Export: HTML-plain"), action: () => doExport("html-plain") },
        { title: t("command.exportImage", "Export: Image"), action: () => doExport("image") },
        { title: t("command.exportPdf", "Export: PDF"), action: () => doExport("pdf") },
        { title: t("command.modeOutlineView", "Mode: Outline View"), action: outlineView },
        { title: t("command.modeSourceCode", "Mode: Source Code"), action: () => File.toggleSourceMode() },
        { title: t("command.modeFocus", "Mode: Focus"), action: () => File.editor.toggleFocusMode() },
        { title: t("command.modeTypewriter", "Mode: Typewriter"), action: () => File.editor.toggleTypeWriterMode() },
        { title: t("command.modeDebug", "Mode: Debug"), action: () => JSBridge.invoke("window.toggleDevTools") },
        ...allThemes.map(theme => {
          const themeName = theme.replace(/\.css$/gi, "")
          return { title: t("command.theme", `Theme: ${themeName}`, { theme: themeName }), action: () => ClientCommand.setTheme(theme) }
        }),
      ]
    },
  },
  {
    prefix: "@",
    name: "Outline",
    fetch: async () => {
      const headers = File?.editor?.nodeMap?.toc?.headers || []
      return headers.reduce((acc, h) => {
        if (h?.attributes && h?.cid) {
          const jump = () => utils.scroll(h.cid)
          acc.push({
            title: h.attributes.pattern.replace("{0}", h.attributes.text),
            action: jump,
            // preview: jump,
          })
        }
        return acc
      }, [])
    },
  },
  {
    prefix: ":",
    name: t("provider.goToLine", "Go to Line"),
    dynamic: true,
    fetch: async (query) => {
      const line = parseInt(query, 10)
      if (isNaN(line) || line <= 0) {
        return [{ title: t("line.prompt", "Type a line number to navigate"), action: () => undefined }]
      }
      const jump = () => {
        if (!File.editor.sourceView.inSourceMode) File.toggleSourceMode()
        utils.scrollSourceView(line)
      }
      return [{
        title: t("line.go", `Go to line ${line}`, { line }),
        action: jump,
        // preview: jump,
      }]
    },
  },
  {
    prefix: "?",
    name: "Help",
    fetch: async () => {
      const helps = [
        { title: t("help.showCommands", "> Show and Run Commands"), prefix: ">" },
        { title: t("help.goToSymbol", "@ Go to Symbol in Editor"), prefix: "@" },
        { title: t("help.searchRecentFiles", "# Search Recent Files"), prefix: "#" },
        { title: t("help.goToLine", ": Go to Line"), prefix: ":" },
        { title: t("help.help", "? Help"), prefix: "?" },
        { title: t("help.searchOpenTabs", "Search Open Tabs"), prefix: "" },
      ]
      return helps.map(h => ({
        title: h.title,
        action: () => {
          context.setInput(h.prefix)
          return false
        },
      }))
    },
  },
  ]
}

class Store {
  listeners = new Set()
  state = { query: "", keywords: [], items: [], activeIndex: 0, loading: false, sessionId: 0 }

  get() {
    return this.state
  }

  set(partialState) {
    const prevState = this.state
    this.state = { ...this.state, ...partialState }
    this.notify(prevState)
  }

  notify(prevState) {
    this.listeners.forEach(listener => listener(this.state, prevState))
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

class Service {
  providers = []

  constructor(providers) {
    this.registerProviders(...providers)
  }

  registerProviders(...providers) {
    this.providers.push(...providers)
    this.prefixes = this.providers.map(p => p.prefix).filter(Boolean).sort((a, b) => b.length - a.length)
  }

  resolveInput(rawInput) {
    const raw = rawInput.trim()
    for (const prefix of this.prefixes) {
      if (raw.startsWith(prefix)) {
        const query = raw.slice(prefix.length).trim()
        return { prefix, query, keywords: this.parseKeywords(query) }
      }
    }
    return { prefix: "", query: raw, keywords: this.parseKeywords(raw) }
  }

  parseKeywords(query) {
    return query.toLowerCase().split(/\s+/).filter(Boolean)
  }

  async fetchItems(prefix, query, keywords) {
    const activeProviders = this.providers.filter(p => p.prefix === prefix)
    const results = await Promise.all(activeProviders.map(p => (
      resolveWithTimeout(() => p.fetch(query, keywords), [], `${p.name || p.prefix || "default"} provider`)
    )))

    return activeProviders.flatMap((p, index) => {
      const providerItems = results[index]
      if (p.dynamic || keywords.length === 0) {
        return providerItems
      }
      return providerItems.filter(item => {
        const title = item.title.toLowerCase()
        return keywords.every(kw => title.includes(kw))
      })
    })
  }
}

class View {
  constructor(entities, utils) {
    this.entities = entities
    this.utils = utils
  }

  render(state, prevState) {
    if (prevState && prevState.items === state.items && prevState.loading === state.loading) {
      if (prevState.activeIndex !== state.activeIndex) {
        this._updateActiveIndex(prevState.activeIndex, state.activeIndex)
      }
      return
    }
    if (state.items.length === 0) {
      this.entities.results.innerHTML = state.loading
        ? `<div class="plugin-command-palette-empty">Searching...</div>`
        : `<div class="plugin-command-palette-empty">No matching results</div>`
      return
    }

    let highlightRegex = null
    if (state.keywords.length > 0) {
      const pattern = state.keywords
        .sort((a, b) => b.length - a.length)
        .map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|")
      highlightRegex = new RegExp(`(${pattern})`, "gi")
    }

    this.entities.results.innerHTML = state.items.map((item, idx) => {
      const title = highlightRegex
        ? item.title.split(highlightRegex).map((part, i) => i % 2 === 1 ? `<b>${this.utils.escape(part)}</b>` : this.utils.escape(part)).join("")
        : this.utils.escape(item.title)
      const activeClass = idx === state.activeIndex ? "active" : ""
      return `<div class="plugin-command-palette-item ${activeClass}" data-index="${idx}">${title}</div>`
    }).join("")

    this.entities.results.querySelector(".active")?.scrollIntoView({ block: "nearest" })
  }

  _updateActiveIndex(prevIndex, nextIndex) {
    const children = this.entities.results.children
    const prevEl = children[prevIndex]
    const nextEl = children[nextIndex]
    prevEl?.classList.remove("active")
    nextEl?.classList.add("active")
    nextEl?.scrollIntoView({ block: "nearest" })
  }

  getInputValue() {
    return this.entities.input.value
  }

  setInputValue(val) {
    this.entities.input.value = val
  }
}

class CommandPalettePlugin extends BasePlugin {
  hotkey = () => [{ hotkey: this.config.HOTKEY, callback: this.call }]

  html = () =>
    `<div class="plugin-command-palette-overlay plugin-common-hidden">
      <div class="plugin-command-palette-panel">
        <input id="plugin-command-palette-input" type="text" placeholder="${this.utils.escape(this.i18n.t("placeholder"))}">
        <div class="plugin-command-palette-results"></div>
      </div>
    </div>`

  style = () => true

  init = () => {
    this.entities = {
      overlay: document.querySelector(".plugin-command-palette-overlay"),
      input: document.querySelector("#plugin-command-palette-input"),
      results: document.querySelector(".plugin-command-palette-results"),
    }

    const providers = buildProviders(this.utils, {
      getAnchor: () => this.anchorNode,
      setInput: (input) => this.setInput(input),
      t: (key, variables) => this.i18n.t(key, variables),
    })
    this.store = new Store()
    this.service = new Service(providers)
    this.view = new View(this.entities, this.utils)
    this.store.subscribe((state, prevState) => this.view.render(state, prevState))
  }

  process = () => {
    this.selectionManager = this.utils.getSelectionManager()

    this.inputHandler = this.utils.createSmartInputHandler(
      this.entities.input,
      val => this.doSearch(val),
      { debounceDelay: this.config.DEBOUNCE_INTERVAL },
    )

    this.entities.input.addEventListener("keydown", async ev => {
      if (this.inputHandler.isComposing()) return
      const state = this.store.get()
      if (ev.key === "ArrowDown") {
        ev.preventDefault()
        if (state.items.length === 0) return
        const nextIndex = (state.activeIndex + 1) % state.items.length
        this.store.set({ activeIndex: nextIndex })
        this.triggerPreview()
        return
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault()
        if (state.items.length === 0) return
        const prevIndex = (state.activeIndex - 1 + state.items.length) % state.items.length
        this.store.set({ activeIndex: prevIndex })
        this.triggerPreview()
        return
      }
      if (ev.key === "Escape" || (ev.key === "Backspace" && this.config.BACKSPACE_TO_HIDE && !this.view.getInputValue())) {
        this.hide()
        return
      }
      if (ev.key === "Enter") {
        ev.stopPropagation()
        ev.preventDefault()
        if (state.items.length === 0 && !state.loading) return
        const currentValue = this.view.getInputValue()
        const isSync = state.query === currentValue && !state.loading
        if (!isSync) {
          await this.doSearch(currentValue)
        }
        this.triggerAction()
      }
    })

    this.entities.results.addEventListener("click", ev => {
      const itemEl = ev.target.closest(".plugin-command-palette-item")
      if (itemEl) {
        const index = parseInt(itemEl.dataset.index, 10)
        this.store.set({ activeIndex: index })
        this.triggerAction()
      }
    })

    this.entities.overlay.addEventListener("click", ev => {
      if (!ev.target.closest(".plugin-command-palette-panel")) this.hide()
    })
  }

  doSearch = async (rawInput) => {
    const currentSessionId = this.store.get().sessionId + 1
    const { prefix, query, keywords } = this.service.resolveInput(rawInput)
    this.store.set({ query: rawInput, keywords, items: [], activeIndex: 0, loading: true, sessionId: currentSessionId })
    try {
      const items = await this.service.fetchItems(prefix, query, keywords)
      if (this.store.get().sessionId !== currentSessionId) return
      this.store.set({ items, activeIndex: 0, loading: false })
      this.triggerPreview()
    } catch (error) {
      console.error("[Command Palette] Fetch Error:", error)
      if (this.store.get().sessionId === currentSessionId) {
        this.store.set({ items: [], activeIndex: 0, loading: false })
      }
    }
  }

  triggerPreview = () => {
    const state = this.store.get()
    const activeItem = state.items[state.activeIndex]
    activeItem?.preview?.({ ...state })
    this.entities.input.focus()
  }

  triggerAction = () => {
    const state = this.store.get()
    const activeItem = state.items[state.activeIndex]
    this.selectionManager.restore()
    if (activeItem?.action({ ...state }) !== false) {
      this.hide()
    }
  }

  setInput = async (input) => {
    this.view.setInputValue(input)
    this.entities.input.focus()
    await this.doSearch(input)
  }

  show = async (input = ">") => {
    this.selectionManager.save()
    this.anchorNode = this.utils.getAnchorNode()
    this.utils.show(this.entities.overlay)
    await this.setInput(input)
  }

  hide = () => {
    const nextSessionId = this.store.get().sessionId + 1
    this.utils.hide(this.entities.overlay)
    this.view.setInputValue("")
    this.store.set({ query: "", keywords: [], items: [], activeIndex: 0, loading: false, sessionId: nextSessionId })
  }

  call = async () => this.utils.isShown(this.entities.overlay) ? this.hide() : this.show()

  registerProviders = (...providers) => this.service.registerProviders(...providers)
}

module.exports = {
  plugin: CommandPalettePlugin,
}
