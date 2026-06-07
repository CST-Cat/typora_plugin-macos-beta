const original = require("../../command_palette.js")
const CommandPalettePlugin = original.plugin

const PROVIDER_TIMEOUT = 2500
const RECENT_FILES_LIMIT = 120

const LOCAL_I18N = {
  en: {
    "placeholder": "Type ? to see available commands",
    "help.showCommands": "> Show and Run Commands",
    "help.goToSymbol": "@ Go to Symbol in Editor",
    "help.searchRecentFiles": "# Search Recent Files",
    "help.goToLine": ": Go to Line",
    "help.help": "? Help",
    "help.searchOpenTabs": "Search Open Tabs",
    "command.showInFinder": "Show in Finder",
    "command.openFileInNewWindow": "Open File In New Window",
    "command.copyFilePath": "Copy File Path",
    "command.togglePreferencePanel": "Toggle Preference Panel",
    "command.togglePinWindow": "Toggle Pin Window",
    "command.openSettingFolder": "Open Setting Folder",
    "command.print": "Print",
    "command.exportHtml": "Export: HTML",
    "command.exportHtmlPlain": "Export: HTML-plain",
    "command.exportImage": "Export: Image",
    "command.exportPdf": "Export: PDF",
    "command.modeOutlineView": "Mode: Outline View",
    "command.modeSourceCode": "Mode: Source Code",
    "command.modeFocus": "Mode: Focus",
    "command.modeTypewriter": "Mode: Typewriter",
    "command.modeDebug": "Mode: Debug",
    "command.theme": "Theme: {{theme}}",
    "provider.goToLine": "Go to Line",
    "line.prompt": "Type a line number to navigate",
    "line.go": "Go to line {{line}}",
  },
  "zh-CN": {
    "placeholder": "输入 ? 查看可用命令",
    "help.showCommands": "> 显示并运行命令",
    "help.goToSymbol": "@ 跳转到文档标题",
    "help.searchRecentFiles": "# 搜索最近文件",
    "help.goToLine": ": 跳转到行号",
    "help.help": "? 帮助",
    "help.searchOpenTabs": "搜索已打开标签页",
    "command.showInFinder": "在访达中显示",
    "command.openFileInNewWindow": "在新窗口打开文件",
    "command.copyFilePath": "复制文件路径",
    "command.togglePreferencePanel": "切换偏好设置面板",
    "command.togglePinWindow": "切换窗口置顶",
    "command.openSettingFolder": "打开配置文件夹",
    "command.print": "打印",
    "command.exportHtml": "导出：HTML",
    "command.exportHtmlPlain": "导出：纯 HTML",
    "command.exportImage": "导出：图片",
    "command.exportPdf": "导出：PDF",
    "command.modeOutlineView": "模式：大纲视图",
    "command.modeSourceCode": "模式：源码模式",
    "command.modeFocus": "模式：专注模式",
    "command.modeTypewriter": "模式：打字机模式",
    "command.modeDebug": "模式：调试",
    "command.theme": "主题：{{theme}}",
    "provider.goToLine": "跳转到行号",
    "line.prompt": "输入行号进行跳转",
    "line.go": "跳转到第 {{line}} 行",
  },
  "zh-TW": {
    "placeholder": "輸入 ? 查看可用命令",
    "help.showCommands": "> 顯示並執行命令",
    "help.goToSymbol": "@ 跳轉到文件標題",
    "help.searchRecentFiles": "# 搜尋最近檔案",
    "help.goToLine": ": 跳轉到行號",
    "help.help": "? 說明",
    "help.searchOpenTabs": "搜尋已開啟標籤頁",
    "command.showInFinder": "在 Finder 中顯示",
    "command.openFileInNewWindow": "在新視窗開啟檔案",
    "command.copyFilePath": "複製檔案路徑",
    "command.togglePreferencePanel": "切換偏好設定面板",
    "command.togglePinWindow": "切換視窗置頂",
    "command.openSettingFolder": "開啟設定資料夾",
    "command.print": "列印",
    "command.exportHtml": "匯出：HTML",
    "command.exportHtmlPlain": "匯出：純 HTML",
    "command.exportImage": "匯出：圖片",
    "command.exportPdf": "匯出：PDF",
    "command.modeOutlineView": "模式：大綱視圖",
    "command.modeSourceCode": "模式：原始碼模式",
    "command.modeFocus": "模式：專注模式",
    "command.modeTypewriter": "模式：打字機模式",
    "command.modeDebug": "模式：除錯",
    "command.theme": "主題：{{theme}}",
    "provider.goToLine": "跳轉到行號",
    "line.prompt": "輸入行號進行跳轉",
    "line.go": "跳轉到第 {{line}} 行",
  },
}

const fillVariables = (text, variables) => {
  if (!variables || typeof text !== "string") return text
  return text.replace(/{{\s*(\w+)\s*}}/g, (match, key) => variables[key] ?? match)
}

const createLocalTranslator = (i18n) => (key, fallback, variables) => {
  const translated = i18n.t(key, variables)
  if (translated && translated !== key) return translated

  const local = LOCAL_I18N[i18n.locale]?.[key] ?? LOCAL_I18N.en[key] ?? fallback
  return fillVariables(local, variables)
}

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

const uniqueItems = items => {
  const seen = new Set()
  return items.filter(item => {
    if (!item?.title || seen.has(item.title)) return false
    seen.add(item.title)
    return true
  })
}

const buildMacosProviders = (utils, context) => {
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
        return (manager?.tabs || []).map(tab => ({ title: tab.path, action: () => manager.switchByPath(tab.path) }))
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
        const mapEntity = isFolder => ent => {
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
        const plugins = Object.entries(utils.getAllBasePlugins()).filter(([_, plugin]) => plugin.call)
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
        const doExport = async name => {
          const [htmlLike] = JSON.parse(await JSBridge.invoke("setting.loadExports"))
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
        return headers.reduce((acc, header) => {
          if (header?.attributes && header?.cid) {
            const jump = () => utils.scroll(header.cid)
            acc.push({
              title: header.attributes.pattern.replace("{0}", header.attributes.text),
              action: jump,
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
      fetch: async query => {
        const line = parseInt(query, 10)
        if (isNaN(line) || line <= 0) {
          return [{ title: t("line.prompt", "Type a line number to navigate"), action: () => undefined }]
        }
        const jump = () => {
          if (!File.editor.sourceView.inSourceMode) File.toggleSourceMode()
          utils.scrollSourceView(line)
        }
        return [{ title: t("line.go", `Go to line ${line}`, { line }), action: jump }]
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
        return helps.map(help => ({
          title: help.title,
          action: () => {
            context.setInput(help.prefix)
            return false
          },
        }))
      },
    },
  ]
}

class MacosCommandPalettePlugin extends CommandPalettePlugin {
  constructor(...args) {
    super(...args)
    const upstreamInit = this.init
    const localT = createLocalTranslator(this.i18n)

    this.html = () =>
      `<div class="plugin-command-palette-overlay plugin-common-hidden">
        <div class="plugin-command-palette-panel">
          <input id="plugin-command-palette-input" type="text" placeholder="${this.utils.escape(localT("placeholder", "Type ? to see available commands"))}">
          <div class="plugin-command-palette-results"></div>
        </div>
      </div>`

    this.init = () => {
      upstreamInit()
      const providers = buildMacosProviders(this.utils, {
        getAnchor: () => this.anchorNode,
        setInput: input => this.setInput(input),
        t: (key, variables) => localT(key, undefined, variables),
      })
      this.service.providers = []
      this.service.registerProviders(...providers)
      this.service.fetchItems = async (prefix, query, keywords) => {
        const activeProviders = this.service.providers.filter(provider => provider.prefix === prefix)
        const results = await Promise.all(activeProviders.map(provider => (
          resolveWithTimeout(() => provider.fetch(query, keywords), [], `${provider.name || provider.prefix || "default"} provider`)
        )))

        return activeProviders.flatMap((provider, index) => {
          const providerItems = results[index]
          if (provider.dynamic || keywords.length === 0) return providerItems
          return providerItems.filter(item => {
            const title = item.title.toLowerCase()
            return keywords.every(keyword => title.includes(keyword))
          })
        })
      }
    }

    this.doSearch = async rawInput => {
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
  }
}

module.exports = { ...original, plugin: MacosCommandPalettePlugin, LOCAL_I18N, createLocalTranslator }
