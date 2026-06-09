const original = require("../../collapse_paragraph.js")
const CollapseParagraphPlugin = original.plugin

const HEADING_SELECTOR = `[mdtype="heading"], [data-type="heading"], .md-heading, h1, h2, h3, h4, h5, h6`
const TEXT_NODE = 3
const SUPPRESS_CLICK_MS = 600

class MacosCollapseParagraphPlugin extends CollapseParagraphPlugin {
  process = () => {
    if (typeof File !== "undefined") {
      File.option ||= {}
      File.option.expandSimpleBlock = false
    }

    this.utils.settings.autoSave(this)
    this.recordCollapseState(false)

    this.collapseFns = this.initCollapseFns()
    this._installMacosEditorClick()
    this._installMacosOutlineClick()
  }

  _ensureWriteEntity = () => {
    const eWrite = this.utils.entities.eWrite || document.querySelector("#write")
    if (!eWrite) return null

    this.utils.entities.eWrite = eWrite
    if (typeof $ === "function" && !this.utils.entities.$eWrite) {
      this.utils.entities.$eWrite = $(eWrite)
    }
    this.utils.entities.querySelectorInWrite ||= (...args) => eWrite.querySelector(...args)
    this.utils.entities.querySelectorAllInWrite ||= (...args) => eWrite.querySelectorAll(...args)
    return eWrite
  }

  _installMacosEditorClick = () => {
    const eWrite = this._ensureWriteEntity()
    if (!eWrite || this._macosEditorClickInstalled) return

    eWrite.addEventListener("mousedown", this.onEditorMouseDown, true)
    eWrite.addEventListener("click", this.onEditorClick)
    this._macosEditorClickInstalled = true
  }

  _installMacosOutlineClick = () => {
    if (this._macosOutlineClickInstalled) return

    const sidebar = document.querySelector(".sidebar-menu")
    if (sidebar) {
      sidebar.addEventListener("click", this.onSidebarClick)
    } else {
      document.addEventListener("click", this.onSidebarClick, true)
    }
    this._macosOutlineClickInstalled = true
  }

  _asElement = (target) => {
    if (!target) return null
    return target.nodeType === TEXT_NODE ? target.parentElement : target
  }

  _getMacosTargetHeader = (target) => {
    const targetElement = this._asElement(target)
    if (!targetElement) return null

    const header = this.navigator.getTargetHeader(targetElement, this.config.STRICT_MODE)
    if (header) return header

    const eWrite = this._ensureWriteEntity()
    const closestHeading = targetElement.closest?.(HEADING_SELECTOR)
    if (!eWrite || !closestHeading || !eWrite.contains(closestHeading)) return null

    return closestHeading
  }

  _findCollapseFn = (ev) => this.collapseFns.find(fn => fn.filter(ev))

  _consumeCollapseEvent = (ev) => {
    const target = this._asElement(ev.target)
    const header = this._getMacosTargetHeader(target)
    if (!header || target?.closest(".md-link")) return

    const collapseFn = this._findCollapseFn(ev)
    if (!collapseFn) return

    document.activeElement?.blur?.()
    const shouldExpand = header.classList.contains(this.className)
    collapseFn.callback(header).forEach(el => this.navigator.toggleCollapse(el, shouldExpand))
    this.callbackOtherPlugin()
    return header
  }

  onEditorMouseDown = (ev) => {
    if (ev.button !== 0) return

    const header = this._consumeCollapseEvent(ev)
    if (!header) return

    this._macosSuppressClickTarget = header
    this._macosSuppressClickUntil = Date.now() + SUPPRESS_CLICK_MS
    ev.preventDefault?.()
    ev.stopImmediatePropagation?.()
    ev.stopPropagation?.()
  }

  onEditorClick = (ev) => {
    const target = this._asElement(ev.target)
    const header = this._getMacosTargetHeader(target)
    if (header && this._macosSuppressClickTarget === header && Date.now() < this._macosSuppressClickUntil) {
      ev.preventDefault?.()
      ev.stopImmediatePropagation?.()
      ev.stopPropagation?.()
      return
    }

    this._consumeCollapseEvent(ev)
  }

  onSidebarClick = (ev) => {
    const target = this._asElement(ev.target)
    const ref = target?.closest(".outline-item")?.querySelector(".outline-label")?.dataset.ref
    if (!ref) return

    const el = this.utils.entities.eWrite.querySelector(`[cid="${ref}"]`)
    if (el && el.style.display === "none") {
      this.navigator.expandParent(el)
    }
  }
}

module.exports = {
  ...original,
  plugin: MacosCollapseParagraphPlugin,
  MacosCollapseParagraphPlugin,
}
