const original = require("../../markdownlint/index.js")
const MarkdownlintPlugin = original.plugin

const createMacosLinterClient = (hooks, contentProvider) => {
  const ACTION = { CHECK: "check", FIX: "fix" }
  const { onCheck, onFix, onError } = hooks
  let LIB
  let RULE_CONFIG
  let CUSTOM_RULES

  const report = (message, level = "info") => {
    window.__TP_MACOS__?.rpc?.("diagnostic.log", {
      source: "markdownlint",
      level,
      message,
    }).catch(() => {})
  }

  const loadCustomRule = file => {
    const normalized = String(file || "").replace(/\\/g, "/")
    if (normalized.endsWith("/plugin/markdownlint/custom-rules.js") || normalized === "plugin/markdownlint/custom-rules.js") {
      return require("../../markdownlint/custom-rules.js")
    }
    throw new Error(`Custom markdownlint rule is not available in macOS WebKit mode: ${file}`)
  }

  const configure = async ({ ruleConfig, customRuleFiles = [] } = {}) => {
    LIB = require("../../markdownlint/markdownlint.min.js")
    const helpers = require("../../markdownlint/markdownlint-rule-helpers.min.js")
    RULE_CONFIG = ruleConfig
    const customRuleLoaders = []
    for (const file of customRuleFiles) {
      try {
        customRuleLoaders.push(loadCustomRule(file))
      } catch (error) {
        report(error?.message || String(error), "warn")
      }
    }
    CUSTOM_RULES = customRuleLoaders.flatMap(define => define(helpers))
    report(`configured markdownlint@${LIB.getVersion()} with ${CUSTOM_RULES.length} custom rules`)
  }

  const run = async (action, customPayload = {}) => {
    try {
      if (!LIB) await configure()
      const content = await contentProvider()
      if (action === ACTION.FIX) {
        if (customPayload.fixInfo?.length) onFix(LIB.applyFixes(content, customPayload.fixInfo))
        return
      }
      const result = await LIB.lint({ strings: { content }, config: RULE_CONFIG, customRules: CUSTOM_RULES })
      const fixInfos = result.content || []
      report(`checked ${fixInfos.length} issues in ${content.length} chars`)
      onCheck(fixInfos)
    } catch (error) {
      const message = error?.stack || error?.message || String(error)
      report(message, "error")
      onError({ message })
    }
  }

  return {
    configure,
    close: () => {},
    check: () => run(ACTION.CHECK),
    fix: (fixInfo) => run(ACTION.FIX, { fixInfo }),
  }
}

class MacosMarkdownlintPlugin extends MarkdownlintPlugin {
  init = () => {
    const hooks = { onCheck: this._onCheck, onFix: this._onFix, onError: event => console.error(event.message) }
    const client = createMacosLinterClient(hooks, this._getLintContent)
    this.linter = {
      configure: async ({ ruleConfig = this.config.RULE_CONFIG, customRuleFiles = this.config.CUSTOM_RULE_FILES, persistent = false } = {}) => {
        if (persistent) {
          const conf = { RULE_CONFIG: ruleConfig, CUSTOM_RULE_FILES: customRuleFiles }
          await this.utils.settings.handle(this.fixedName, pluginSettings => Object.assign(pluginSettings, conf))
          Object.assign(this.config, conf)
        }
        client.configure({
          ruleConfig,
          customRuleFiles: customRuleFiles.map(f => this.utils.resolvePluginPath(f)),
        })
      },
      close: client.close,
      check: client.check,
      fix: (fixInfo = this.fixInfos) => client.fix(fixInfo),
    }

    this.entities = {
      panel: document.querySelector("#plugin-markdownlint"),
      wrap: document.querySelector(".plugin-markdownlint-table-wrap"),
      table: document.querySelector(".plugin-markdownlint-table"),
      button: document.querySelector("#plugin-markdownlint-button"),
    }
    this._initTableColumns()
  }

  process = () => {
    const onLifecycle = () => {
      const { eventHub } = this.utils
      const debouncedCheck = this.utils.debounce(this.linter.check, 500)
      const delayedCheck = delay => setTimeout(() => this.linter.check(), delay)
      eventHub.addEventListener(eventHub.eventType.fileEdited, debouncedCheck)
      eventHub.addEventListener(eventHub.eventType.fileContentLoaded, () => delayedCheck(500))
      eventHub.addEventListener(eventHub.eventType.fileOpened, () => delayedCheck(800))
      eventHub.addEventListener(eventHub.eventType.allPluginsHadInjected, () => {
        this.linter.configure()
        delayedCheck(1000)
      })
      eventHub.addEventListener(eventHub.eventType.toggleSettingPage, force => {
        if (force) this.entities.panel.toggle(force)
        if (this.entities.button) this.utils.toggleInvisible(this.entities.button, force)
      })
    }

    const _getDetail = async (infos = this.fixInfos) => {
      const attrs = ["lineNumber", "ruleNames", "errorDetail", "errorContext", "errorRange", "fixInfo"]
      const infoList = infos.map(info => this.utils.pick(info, attrs))
      const value = infoList.length === 1 ? infoList[0] : infoList
      const content = JSON.stringify(value, null, "  ")
      await this.utils.formDialog.modal({
        title: this.i18n.t("$option.actions.detailAll"),
        schema: ({ Controls }) => [Controls.Textarea("detail").Rows(14).Readonly(true)],
        data: { detail: content },
      })
    }

    const fnMap = {
      close: () => this.entities.panel.toggle(true),
      refresh: () => {
        this.linter.check()
        this.utils.notification.show(this.i18n.t("success.refresh"))
      },
      detailAll: () => _getDetail(this.fixInfos),
      fixAll: () => this.linter.fix(this.fixInfos),
      detailSingle: idx => _getDetail([this.fixInfos[idx]]),
      fixSingle: idx => this.linter.fix([this.fixInfos[idx]]),
      toggleSourceMode: () => File.toggleSourceMode(),
      settings: this.settings,
      jumpToLine: lineToGo => {
        if (!lineToGo) return
        if (!File.editor.sourceView.inSourceMode) File.toggleSourceMode()
        this.utils.scrollSourceView(lineToGo)
      },
    }

    const onIndicatorMouseDown = ev => {
      if (ev.button === 0) {
        ev.preventDefault()
        ev.stopPropagation()
        this.call()
      } else if (ev.button === 2) {
        ev.preventDefault()
        ev.stopPropagation()
        fnMap[this.config.RIGHT_CLICK_INDICATOR_ACTION]?.()
      }
    }
    const isIndicatorHit = ev => {
      const rect = this.entities.button?.getBoundingClientRect()
      if (!rect) return false
      const hitPadding = 12
      return ev.clientX >= rect.left - hitPadding
        && ev.clientX <= rect.right + hitPadding
        && ev.clientY >= rect.top - hitPadding
        && ev.clientY <= rect.bottom + hitPadding
    }

    const onElementEvent = () => {
      this.entities.button?.addEventListener("mousedown", onIndicatorMouseDown)
      document.addEventListener("mousedown", ev => {
        if (isIndicatorHit(ev)) onIndicatorMouseDown(ev)
      }, true)
      this.entities.wrap.addEventListener("mousedown", ev => {
        ev.preventDefault()
        ev.stopPropagation()
        if (ev.button === 2) fnMap[this.config.RIGHT_CLICK_TABLE_ACTION]?.()
      })
      this.entities.panel.addEventListener("btn-click", ev => fnMap[ev.detail.action]?.())
      this.entities.table.addEventListener("row-action", ev => {
        const { action, rowData } = ev.detail
        const arg = (action === "fixSingle" || action === "detailSingle") ? rowData.idx : rowData.line
        fnMap[action](arg)
      })
    }

    onLifecycle()
    onElementEvent()
  }

  call = () => {
    window.__TP_MACOS__?.rpc?.("diagnostic.log", {
      source: "markdownlint",
      level: "info",
      message: "Markdownlint panel requested",
    }).catch(() => {})
    const panel = this.entities.panel
    panel.hidden = false
    panel.removeAttribute("hidden")
    panel.style.setProperty("display", "flex", "important")
    panel.style.setProperty("visibility", "visible", "important")
    panel.style.setProperty("opacity", "1", "important")
    panel.style.setProperty("right", "64px", "important")
    panel.style.setProperty("left", "auto", "important")
    panel.style.setProperty("top", "128px", "important")
    panel.style.setProperty("width", "min(620px, calc(100vw - 96px))", "important")
    panel.style.setProperty("height", "min(420px, calc(100vh - 176px))", "important")
    panel.style.setProperty("z-index", "10001", "important")
    panel.style.setProperty("transform", "none", "important")
    panel.classList.remove("hiding", "plugin-common-hidden")
    panel.classList.add("showing")
    setTimeout(() => this.linter.check(), 0)
  }

  _getLintContent = async () => {
    const readCurrent = reader => {
      try {
        const content = reader?.()
        return typeof content === "string" ? content : ""
      } catch (error) {
        console.warn("[Markdownlint] Failed to read current editor content", error)
        return ""
      }
    }
    const editorContent = readCurrent(() => this.utils.getCurrentFileContent())
    if (editorContent) return editorContent

    if (typeof File !== "undefined" && typeof File.getContent === "function") {
      const fileContent = await Promise.resolve(File.getContent()).catch(error => {
        console.warn("[Markdownlint] Failed to read File.getContent()", error)
        return ""
      })
      if (typeof fileContent === "string") return fileContent
    }
    return readCurrent(() => window.getMarkdown?.())
  }

  _onCheck = fixInfos => {
    fixInfos = Array.isArray(fixInfos) ? fixInfos : []
    this.fixInfos = fixInfos
    this.entities.button?.toggleAttribute("lint-check-failed", !!fixInfos.length)
    if (!this.entities.panel.hidden) {
      this.entities.table.setData(fixInfos.map((item, idx) => {
        const rule = item.ruleNames[0]
        const line = item.lineNumber
        const fixable = !!item.fixInfo
        const desc = (this.config.TRANSLATE && this.TRANSLATIONS[rule]) || item.ruleDescription
        return { idx, rule, line, fixable, desc }
      }))
    }
  }
}

module.exports = { ...original, plugin: MacosMarkdownlintPlugin }
