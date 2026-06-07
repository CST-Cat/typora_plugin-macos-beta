const original = require("../../window_tab.js")
const WindowTabPlugin = original.plugin
const TabManager = original.TabManager

const noop = () => {}
const MACOS_TAB_DRAG_THRESHOLD = 6

const resolveMacosTabMoveIndex = (rects, fromIdx, clientX) => {
  const count = rects.length
  if (count === 0 || fromIdx < 0 || fromIdx >= count) return fromIdx

  let insertIdx = count
  for (let idx = 0; idx < count; idx++) {
    const rect = rects[idx]
    if (clientX < rect.left + rect.width / 2) {
      insertIdx = idx
      break
    }
  }

  const toIdx = fromIdx < insertIdx ? insertIdx - 1 : insertIdx
  return Math.min(Math.max(0, toIdx), count - 1)
}

class MacosTabManager extends TabManager {
  constructor(context) {
    super(context)
    this.hooks.onBeforeSwitch = context.onBeforeSwitch
  }

  _ensureScrollState = tab => {
    if (!tab) return tab
    tab.scrollTop = tab.scrollTop || 0
    tab.scrollAnchor = tab.scrollAnchor || null
    tab.scrollRatio = tab.scrollRatio || 0
    return tab
  }

  open(wantOpenPath) {
    super.open(wantOpenPath)
    this._tabs.forEach(this._ensureScrollState)
  }

  switch(idx) {
    const nextIdx = Math.min(Math.max(0, idx), this.maxIdx)
    if (nextIdx !== this._activeIdx) {
      this.hooks.onBeforeSwitch?.(this.current, this._tabs[nextIdx])
    }
    this._activeIdx = nextIdx
    this.utils.openFile(this.current?.path, true)
  }

  async checkExist() {
    if (typeof window !== "undefined" && window.__TP_MACOS__) return
    return super.checkExist()
  }

  restoreSession(saveTabs, mountFolder, currentMountFolder, matchMountFolder = false) {
    if (!saveTabs || saveTabs.length === 0) return
    if (matchMountFolder && mountFolder !== currentMountFolder) return

    const activePath = saveTabs.find(tab => tab.active)?.path
    this._tabs = saveTabs.map(({ path, scrollTop, scrollAnchor, scrollRatio }) => ({
      path,
      scrollTop: scrollTop || 0,
      scrollAnchor: scrollAnchor || null,
      scrollRatio: scrollRatio || 0,
    }))

    this._formatShowNames()

    if (activePath) this.switchByPath(activePath)
    else this.switch(0)
  }
}

class MacosWindowTabPlugin extends WindowTabPlugin {
  constructor(...args) {
    super(...args)
    const upstreamInit = this.init
    const upstreamProcess = this.process
    const upstreamInsertTabDiv = this._insertTabDiv
    const upstreamRenderTabs = this._renderTabs

    this._macosTabDragState = null
    this._macosTabDragClickSuppressUntil = 0
    this._pendingScrollRestorePath = null
    this._activeScrollRestoreToken = null
    this._scrollRestoreTimers = []
    this._scrollRestoreRafs = []
    this._ignoreScrollRecordUntil = 0
    this.init = () => {
      upstreamInit()
      this.entities.content ||= document.querySelector("content") || document.scrollingElement || document.documentElement
      this.entities.source ||= document.querySelector("#typora-source")
      this.entities.header ||= { getBoundingClientRect: () => ({ height: 0, top: 0 }) }
      document.body.classList.toggle("plugin-window-tab-macos", this._isMacosWebKit())
    }
    this.process = () => {
      this._withQuickOpenFallback(() => upstreamProcess())
      this._installMacosLifecycle()
      this._installMacosScrollRecorder()
      this._installMacosLayout()
      this._installMacosNewFileButton()
      this._installMacosTabDragFallback()
      this._openInitialCurrentFile()
    }
    this._insertTabDiv = (filePath, showName, idx) => {
      if (!this.entities.tabWrapper) return
      const ret = upstreamInsertTabDiv(filePath, showName, idx)
      this._syncMacosTabDragFallback()
      return ret
    }
    this._renderTabs = wantOpenPath => {
      if (!this.entities.tabWrapper) return
      const ret = upstreamRenderTabs(wantOpenPath)
      this._syncMacosTabDragFallback()
      return ret
    }
    this._patchTabManager()
  }

  _patchTabManager = () => {
    this.tab = new MacosTabManager({
      utils: this.utils,
      i18n: this.i18n,
      config: this.config,
      onRender: wantOpenPath => {
        this.renderRafManager.schedule(() => {
          this._showTabBar()
          this._startCheckTabsInterval()
          this._renderTabs(wantOpenPath)
        })
      },
      onBeforeSwitch: (_currentTab, nextTab) => {
        this._recordCurrentScrollTop()
        this._requestScrollRestore(nextTab?.path)
        this._switchingByTab = true
      },
      onEmpty: this._onEmptyTabList,
      onExit: () => this.utils.exitTypora(),
    })
  }

  _onEmptyTabList = async () => {
    this._hideTabBar()
    this._stopCheckTabsInterval()
    this.tab.reset()
    File.bundle = {
      filePath: "", originalPath: null, untitledId: +new Date,
      fileName: null, fileEncode: null, removed: false,
      useCRLF: File.useCRLF || false, unsupported: "",
      hasModified: false, modifiedDate: null, lastSnapDate: null,
      savedContent: null, isLocked: false, oversize: false,
      fileMissingWhenOpen: false, bundleFile: null, zip: null,
    }
    await this.utils.reload()
    const titleText = document.getElementById("title-text")
    if (titleText) titleText.innerHTML = "Typora"
    document.querySelector(".file-library-node.active")?.classList.remove("active")
  }

  _isMacosWebKit = () => typeof window !== "undefined" && !!window.__TP_MACOS__

  prepare = () => {
    if (window._options?.framelessWindow && this.config.HIDE_WINDOW_TITLE_BAR) {
      const header = document.querySelector("header")
      const titleBar = document.getElementById("top-titlebar")
      if (header) header.style.zIndex = "897"
      if (titleBar) titleBar.style.display = "none"
    }
    if (this.config.LAST_TAB_CLOSE_ACTION === "blankPage" && this.utils.isBetaVersion) {
      this.config.LAST_TAB_CLOSE_ACTION = "reconfirm"
    }
  }

  _withQuickOpenFallback = callback => {
    const fallbackSelectors = new Set([".typora-quick-open-list", "#typora-quick-open-input > input"])
    const fallbackTarget = { addEventListener: noop }
    const hadOwnQuerySelector = Object.hasOwn(document, "querySelector")
    const originalQuerySelector = document.querySelector

    document.querySelector = function (selector) {
      const result = originalQuerySelector.call(document, selector)
      return result || (fallbackSelectors.has(selector) ? fallbackTarget : null)
    }

    try {
      return callback()
    } finally {
      if (hadOwnQuerySelector) document.querySelector = originalQuerySelector
      else delete document.querySelector
    }
  }

  _installMacosLifecycle = () => {
    const eventHub = this.utils.eventHub
    const { beforeFileOpen, fileOpened } = eventHub.eventType

    eventHub.addEventListener(beforeFileOpen, () => {
      this._cancelScrollRestore()
      this._macosPreviousPath = this.tab.current?.path
      if (this._switchingByTab) {
        this._switchingByTab = false
      } else {
        this._recordCurrentScrollTop()
      }
    })

    eventHub.addEventListener(fileOpened, path => {
      const previousPath = this._macosPreviousPath
      this._macosPreviousPath = null
      if (path && path !== previousPath) this._requestScrollRestore(path)
    })
  }

  _installMacosScrollRecorder = () => {
    const scrollEl = this._getScrollElement()
    if (!scrollEl) return
    scrollEl.addEventListener("scroll", this.utils.debounce(this._recordCurrentScrollTop, 100), { passive: true })
    const cancelUserRestore = () => this._cancelPendingScrollRestore()
    scrollEl.addEventListener("wheel", cancelUserRestore, { passive: true })
    scrollEl.addEventListener("touchstart", cancelUserRestore, { passive: true })
  }

  _installMacosLayout = () => {
    const updateMacosLayout = this.utils.debounce(() => {
      this._updateMacosLayout()
      this._adjustContentTop()
    }, 80)
    this._updateMacosLayout()
    window.addEventListener("resize", updateMacosLayout)
    this.utils.eventHub.addEventListener(this.utils.eventHub.eventType.afterToggleSidebar, updateMacosLayout)
    this.utils.eventHub.addEventListener(this.utils.eventHub.eventType.afterSetSidebarWidth, updateMacosLayout)
    setTimeout(updateMacosLayout, 250)
  }

  _installMacosNewFileButton = () => {
    this.entities.newTabButton?.addEventListener("click", async ev => {
      if (!this._isMacosWebKit()) return
      ev.preventDefault()
      ev.stopPropagation()
      ev.stopImmediatePropagation()
      await this._createMacosNewFile()
    }, true)
  }

  _installMacosTabDragFallback = () => {
    if (!this._isMacosWebKit() || this._macosTabDragFallbackInstalled || !this.entities.tabWrapper) return
    this._macosTabDragFallbackInstalled = true
    this._injectMacosTabDragStyle()
    this._syncMacosTabDragFallback()
    this.entities.tabWrapper.addEventListener("mousedown", this._onMacosTabMouseDown, true)
    this.entities.tabWrapper.addEventListener("click", this._onMacosTabClick, true)
    this.entities.tabWrapper.addEventListener("dragstart", this._onMacosNativeTabDragStart, true)
    this.entities.tabWrapper.addEventListener("selectstart", this._onMacosTabSelectStart, true)
  }

  _syncMacosTabDragFallback = () => {
    if (!this._isMacosWebKit() || !this.entities?.tabWrapper) return
    this.entities.tabWrapper.querySelectorAll(".tab-container").forEach(tab => {
      tab.draggable = false
      tab.setAttribute("draggable", "false")
    })
  }

  _injectMacosTabDragStyle = () => {
    if (document.getElementById("plugin-window-tab-macos-drag-style")) return
    const style = document.createElement("style")
    style.id = "plugin-window-tab-macos-drag-style"
    style.textContent = `
      body.plugin-window-tab-macos #plugin-window-tab .tab-container {
        cursor: default;
        user-select: none !important;
        -webkit-user-select: none !important;
        -webkit-user-drag: none !important;
      }

      body.plugin-window-tab-macos #plugin-window-tab .tab-container * {
        user-select: none !important;
        -webkit-user-select: none !important;
        -webkit-user-drag: none !important;
      }

      body.plugin-window-tab-macos #plugin-window-tab .tab-container .window-tab-name,
      body.plugin-window-tab-macos #plugin-window-tab .tab-container .active-indicator {
        pointer-events: none;
      }

      body.plugin-window-tab-macos-dragging {
        user-select: none !important;
        -webkit-user-select: none !important;
      }

      body.plugin-window-tab-macos #plugin-window-tab .tab-container.macos-tab-dragging {
        opacity: 0.35;
      }

      body.plugin-window-tab-macos .macos-tab-drag-ghost {
        box-sizing: border-box;
        opacity: 0.9;
        pointer-events: none;
        position: fixed;
        z-index: 99999;
      }
    `
    document.head.append(style)
  }

  _onMacosNativeTabDragStart = ev => {
    if (!this._isMacosWebKit()) return
    if (!ev.target.closest("#plugin-window-tab .tab-container")) return
    ev.preventDefault()
    ev.stopImmediatePropagation()
  }

  _onMacosTabSelectStart = ev => {
    if (!this._isMacosWebKit()) return
    if (ev.target.closest("#plugin-window-tab .tab-container") && !ev.target.closest(".close-button")) {
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }
  }

  _onMacosTabClick = ev => {
    if (Date.now() > this._macosTabDragClickSuppressUntil) return
    this._macosTabDragClickSuppressUntil = 0
    this._clearMacosTabSelection()
    ev.preventDefault()
    ev.stopImmediatePropagation()
  }

  _onMacosTabMouseDown = ev => {
    if (!this._isMacosWebKit() || ev.button !== 0) return
    if (ev.target.closest(".close-button")) return

    const tabEl = ev.target.closest("#plugin-window-tab .tab-container")
    if (!tabEl || !this.entities.tabWrapper.contains(tabEl)) return

    const fromIdx = parseInt(tabEl.dataset.idx)
    if (isNaN(fromIdx)) return

    ev.preventDefault()
    this._clearMacosTabSelection()
    this._macosTabDragState = {
      fromIdx,
      startX: ev.clientX,
      startY: ev.clientY,
      tabEl,
      dragging: false,
    }
    document.addEventListener("mousemove", this._onMacosTabMouseMove, true)
    document.addEventListener("mouseup", this._onMacosTabMouseUp, true)
  }

  _onMacosTabMouseMove = ev => {
    const state = this._macosTabDragState
    if (!state) return

    const distanceX = Math.abs(ev.clientX - state.startX)
    const distanceY = Math.abs(ev.clientY - state.startY)
    if (!state.dragging && Math.max(distanceX, distanceY) < MACOS_TAB_DRAG_THRESHOLD) return

    if (!state.dragging) this._startMacosLiveTabDrag(state, ev)
    this._syncMacosLiveTabOrder(state, ev.clientX)
    this._updateMacosTabDragGhost(state, ev)
    this._clearMacosTabSelection()
    ev.preventDefault()
    ev.stopPropagation()
  }

  _onMacosTabMouseUp = ev => {
    const state = this._macosTabDragState
    this._macosTabDragState = null
    document.removeEventListener("mousemove", this._onMacosTabMouseMove, true)
    document.removeEventListener("mouseup", this._onMacosTabMouseUp, true)
    if (!state) return

    this._teardownMacosLiveTabDrag(state)
    this._clearMacosTabSelection()
    if (!state.dragging) return

    ev.preventDefault()
    ev.stopImmediatePropagation()
    this._macosTabDragClickSuppressUntil = Date.now() + 400
    this._commitMacosLiveTabOrder()
  }

  _startMacosLiveTabDrag = (state, ev) => {
    const rect = state.tabEl.getBoundingClientRect()
    state.dragging = true
    state.offsetX = ev.clientX - rect.left
    state.offsetY = ev.clientY - rect.top
    state.ghostTop = rect.top

    const ghost = state.tabEl.cloneNode(true)
    ghost.classList.remove("macos-tab-dragging")
    ghost.classList.add("macos-tab-drag-ghost")
    ghost.style.width = `${rect.width}px`
    ghost.style.height = `${rect.height}px`
    document.body.append(ghost)
    state.ghost = ghost

    state.tabEl.classList.add("macos-tab-dragging")
    document.body.classList.add("plugin-window-tab-macos-dragging")
    this._updateMacosTabDragGhost(state, ev)
  }

  _syncMacosLiveTabOrder = (state, clientX) => {
    const wrapper = this.entities?.tabWrapper
    if (!wrapper || !state.tabEl?.isConnected) return

    const tabs = Array.from(wrapper.querySelectorAll(".tab-container"))
    const target = tabs.find(tab => {
      if (tab === state.tabEl) return false
      const rect = tab.getBoundingClientRect()
      return clientX < rect.left + rect.width / 2
    })
    if (target) {
      wrapper.insertBefore(state.tabEl, target)
    } else {
      wrapper.append(state.tabEl)
    }
  }

  _updateMacosTabDragGhost = (state, ev) => {
    if (!state.ghost) return
    const left = Math.round(ev.clientX - state.offsetX)
    const top = Math.round(state.ghostTop)
    state.ghost.style.transform = `translate3d(${left}px, ${top}px, 0)`
  }

  _teardownMacosLiveTabDrag = state => {
    state.tabEl.classList.remove("macos-tab-dragging")
    document.body.classList.remove("plugin-window-tab-macos-dragging")
    state.ghost?.remove()
    state.ghost = null
  }

  _commitMacosLiveTabOrder = () => {
    const wrapper = this.entities?.tabWrapper
    if (!wrapper) return

    const orderedTabs = Array.from(wrapper.querySelectorAll(".tab-container"))
    const nextTabs = orderedTabs
      .map(el => this.tab.getByIdx(parseInt(el.dataset.idx)))
      .filter(Boolean)
    if (nextTabs.length !== this.tab.count) {
      this.tab.hooks.onRender?.(this.tab.current?.path)
      return
    }

    const activePath = this.tab.current?.path
    const before = this.tab.tabs.map(tab => tab.path).join("\n")
    const after = nextTabs.map(tab => tab.path).join("\n")
    if (before === after) return

    this.tab.reset(nextTabs)
    if (activePath) this.tab.open(activePath)
    else this.tab.hooks.onRender?.(this.tab.current?.path)
  }

  _clearMacosTabSelection = () => {
    window.getSelection?.()?.removeAllRanges?.()
    document.getSelection?.()?.removeAllRanges?.()
  }

  _getMacosTabMoveIndex = (fromIdx, clientX) => {
    const rects = Array.from(this.entities.tabWrapper.querySelectorAll(".tab-container"))
      .map(el => el.getBoundingClientRect())
    return resolveMacosTabMoveIndex(rects, fromIdx, clientX)
  }

  _openInitialCurrentFile = () => {
    if (this.tab.count > 0) return
    const open = () => {
      if (this.tab.count > 0) return true
      const filePath = this.utils.getFilePath()
      if (!filePath) return false
      this.tab.open(filePath)
      this._logMacos("initial tab opened", filePath)
      return true
    }
    if (open()) return
    this.utils.waitUntil(open, 100, 5000)
      .catch(() => this._logMacos("initial tab skipped", "empty file path"))
  }

  _logMacos = (message, data) => {
    if (!window.__TP_MACOS__?.rpc) return
    window.__TP_MACOS__.rpc("diagnostic.log", {
      source: "window_tab",
      level: "info",
      message: data === undefined ? message : `${message}: ${data}`,
    }).catch(this.utils.noop)
  }

  _createMacosNewFile = async () => {
    const dispatchNativeClick = target => {
      if (!target) return false
      for (const type of ["mousedown", "mouseup", "click"]) {
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
      }
      return true
    }

    const nativeNewFileButton = document.querySelector("#sidebar-new-file-btn")
    if (dispatchNativeClick(nativeNewFileButton)) return

    const menuNewFileAction = document.querySelector('[data-action="new_file"]')
    if (dispatchNativeClick(menuNewFileAction)) return

    try {
      if (window.JSBridge?.invoke) {
        await window.JSBridge.invoke("controller.runCommand", "new_file")
      } else if (window.bridge?.callHandler) {
        await new Promise(resolve => window.bridge.callHandler("controller.runCommand", "new_file", resolve))
      }
    } catch (err) {
      window.__TP_MACOS__?.rpc?.("diagnostic.log", {
        source: "window_tab",
        level: "warn",
        message: `new file action failed: ${err?.message || err}`,
      }).catch(this.utils.noop)
      throw err
    }
  }

  _getMacosTitlebarBottom = () => {
    const titleText = document.getElementById("title-text")
    const candidates = [
      document.getElementById("top-titlebar"),
      this.entities.header,
      titleText?.closest("#top-titlebar"),
      titleText?.parentElement,
    ].filter(el => el?.nodeType === 1)
    const bottoms = candidates
      .map(el => {
        const style = window.getComputedStyle(el)
        if (style.display === "none" || style.visibility === "hidden") return 0
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 ? rect.top + rect.height : 0
      })
      .filter(bottom => bottom > 0 && bottom < 120)
    return Math.ceil(Math.max(40, ...bottoms))
  }

  _updateMacosLayout = () => {
    if (!this._isMacosWebKit() || !this.entities.windowTab) return
    const sidebar = document.querySelector("#typora-sidebar")
    const sidebarRect = sidebar?.getBoundingClientRect()
    const sidebarStyle = sidebar ? window.getComputedStyle(sidebar) : null
    const sidebarVisible = sidebarRect
      && sidebarRect.width > 0
      && sidebarStyle?.display !== "none"
      && sidebarStyle?.visibility !== "hidden"
    const sidebarWidth = sidebarVisible ? Math.ceil(sidebarRect.width) : 0
    const tabHeight = Math.ceil(this.entities.windowTab.getBoundingClientRect().height || 40)
    const titlebarBottom = this._getMacosTitlebarBottom()
    this.entities.windowTab.style.removeProperty("top")
    document.documentElement.style.setProperty("--plugin-window-tab-left", `${sidebarWidth}px`)
    document.documentElement.style.setProperty("--plugin-window-tab-traffic-left", sidebarWidth ? "0px" : "92px")
    document.documentElement.style.setProperty("--plugin-window-tab-top", `${titlebarBottom}px`)
    document.documentElement.style.setProperty("--plugin-window-tab-height", `${tabHeight}px`)
  }

  _getScrollElement = () => this.entities?.content || document.querySelector("content") || document.scrollingElement || document.documentElement

  _getScrollTop = () => this._getScrollElement()?.scrollTop || 0

  _setScrollTop = scrollTop => {
    const scrollEl = this._getScrollElement()
    if (!scrollEl) return
    const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
    scrollEl.scrollTop = Math.min(Math.max(0, scrollTop || 0), maxScrollTop)
  }

  _getScrollRatio = () => {
    const scrollEl = this._getScrollElement()
    if (!scrollEl) return 0
    const maxScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight
    return maxScrollTop > 0 ? this._getScrollTop() / maxScrollTop : 0
  }

  _cancelScrollRestore = () => {
    for (const timer of this._scrollRestoreTimers) clearTimeout(timer)
    for (const raf of this._scrollRestoreRafs) cancelAnimationFrame(raf)
    this._scrollRestoreTimers = []
    this._scrollRestoreRafs = []
    this._activeScrollRestoreToken = null
  }

  _cancelPendingScrollRestore = () => {
    this._pendingScrollRestorePath = null
    this._cancelScrollRestore()
  }

  _requestScrollRestore = filepath => {
    if (filepath) this._pendingScrollRestorePath = filepath
  }

  _consumeScrollRestore = filepath => {
    if (this._pendingScrollRestorePath !== filepath) return false
    this._pendingScrollRestorePath = null
    return true
  }

  _recordCurrentScrollTop = () => {
    if (typeof performance !== "undefined" && performance.now() < this._ignoreScrollRecordUntil) return
    const cur = this.tab.current
    if (!cur) return
    cur.scrollTop = this._getScrollTop()
    cur.scrollRatio = this._getScrollRatio()
    cur.scrollAnchor = this._captureScrollAnchor()
  }

  _getScrollViewportRect = scrollEl => {
    if (!scrollEl || scrollEl === document.scrollingElement || scrollEl === document.documentElement || scrollEl === document.body) {
      return { top: 0, bottom: window.innerHeight }
    }
    const rect = scrollEl.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom }
  }

  _getScrollAnchorRoot = () => this.utils.entities.eWrite || document.querySelector("#write")

  _findAnchorElementByCid = cid => {
    const root = this._getScrollAnchorRoot()
    if (!root || !cid) return null
    return Array.from(root.querySelectorAll("[cid]")).find(el => el.getAttribute("cid") === cid)
  }

  _captureScrollAnchor = () => {
    const scrollEl = this._getScrollElement()
    const root = this._getScrollAnchorRoot()
    if (!scrollEl || !root) return null

    const viewport = this._getScrollViewportRect(scrollEl)
    const viewportTop = viewport.top + 4
    const candidates = Array.from(root.querySelectorAll("[cid]"))
    const anchor = candidates.find(el => {
      const rect = el.getBoundingClientRect()
      return rect.height > 0 && rect.bottom >= viewportTop && rect.top <= viewport.bottom
    })
    if (!anchor) return null

    const cid = anchor.getAttribute("cid")
    if (!cid) return null

    const rect = anchor.getBoundingClientRect()
    return {
      cid,
      offsetTop: Math.round(rect.top - viewport.top),
    }
  }

  _restoreTabScrollPosition = tab => {
    const scrollEl = this._getScrollElement()
    if (!scrollEl || !tab) return

    const anchor = tab.scrollAnchor
    const anchorEl = anchor?.cid && this._findAnchorElementByCid(anchor.cid)
    if (anchorEl) {
      const viewport = this._getScrollViewportRect(scrollEl)
      const rect = anchorEl.getBoundingClientRect()
      this._setScrollTop(this._getScrollTop() + rect.top - viewport.top - (anchor.offsetTop || 0))
      return
    }

    if (typeof tab.scrollRatio === "number" && tab.scrollRatio > 0) {
      const maxScrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
      this._setScrollTop(maxScrollTop * tab.scrollRatio)
      return
    }

    this._setScrollTop(tab.scrollTop || 0)
  }

  _scheduleScrollRestore = (filepath, tab) => {
    this._cancelScrollRestore()
    const token = Symbol(filepath)
    this._activeScrollRestoreToken = token

    const applyScroll = () => {
      if (this._activeScrollRestoreToken !== token || this.utils.getFilePath() !== filepath) return
      if (typeof performance !== "undefined") this._ignoreScrollRecordUntil = performance.now() + 200
      this._restoreTabScrollPosition(tab)
    }

    if (typeof requestAnimationFrame === "function") {
      const raf = requestAnimationFrame(() => {
        const secondRaf = requestAnimationFrame(applyScroll)
        this._scrollRestoreRafs.push(secondRaf)
      })
      this._scrollRestoreRafs.push(raf)
    } else {
      applyScroll()
    }

    for (const delay of [80, 250, 600]) {
      this._scrollRestoreTimers.push(setTimeout(applyScroll, delay))
    }
    this._scrollRestoreTimers.push(setTimeout(() => {
      if (this._activeScrollRestoreToken === token) this._activeScrollRestoreToken = null
    }, 700))
  }

  _hideTabBar = () => {
    if (this.entities.windowTab && this.utils.isShown(this.entities.windowTab) && this.tab.count === 0) {
      this.utils.hide(this.entities.windowTab)
      this._resetContentTop()
    }
  }

  _showTabBar = () => {
    if (this.entities.windowTab && this.utils.isHidden(this.entities.windowTab)) {
      this.utils.show(this.entities.windowTab)
      this._adjustContentTop()
    }
  }

  _adjustContentTop = () => {
    if (!this.entities.windowTab || !this.entities.content || !this.entities.source) return
    const { height, top } = this.entities.windowTab.getBoundingClientRect()
    if (height + top === 0) {
      this._resetContentTop()
    } else {
      const headerRect = document.querySelector("header")?.getBoundingClientRect()
      const headerBottom = headerRect ? headerRect.height + headerRect.top : 0
      const t = Math.max(top + height, headerBottom) + "px"
      this.entities.content.style.top = t
      this.entities.source.style.top = t
    }
  }

  _resetContentTop = () => {
    this.entities.content?.style.removeProperty("top")
    this.entities.source?.style.removeProperty("top")
  }

  _scrollContent = filepath => {
    const activeTab = this.tab.tabs.find(tab => tab.path === filepath)
    if (!activeTab) return
    if (!this._consumeScrollRestore(filepath)) return
    this._scheduleScrollRestore(filepath, activeTab)
  }

  saveTabs = storage => {
    this._recordCurrentScrollTop()
    storage.set({
      mount_folder: this.utils.getMountFolder(),
      save_tabs: this.tab.tabs.map((tab, idx) => ({
        idx,
        path: tab.path,
        scrollTop: tab.scrollTop,
        active: idx === this.tab.activeIdx,
        scrollAnchor: tab.scrollAnchor || null,
        scrollRatio: tab.scrollRatio || 0,
      })),
    })
  }

  openSaveTabs = (storage, matchMountFolder = false) => {
    const { save_tabs, mount_folder } = storage.get() || {}
    const activePath = save_tabs?.find(tab => tab.active)?.path || save_tabs?.[0]?.path
    this._requestScrollRestore(activePath)
    this.tab.restoreSession(save_tabs, mount_folder, this.utils.getMountFolder(), matchMountFolder)
  }
}

module.exports = { ...original, plugin: MacosWindowTabPlugin, MacosTabManager, resolveMacosTabMoveIndex }
