global.BasePlugin = class {
  constructor(fixedName, config, i18n) {
    this.fixedName = fixedName
    this.config = config
    this.i18n = i18n
  }
}

const { describe, it, beforeEach, mock } = require("node:test")
const assert = require("node:assert")
const { JSDOM } = require("jsdom")
const { plugin: CollapseParagraphPlugin } = require("../../plugin/macos/adapters/collapse_paragraph.js")

const createPlugin = () => {
  const dom = new JSDOM(`<!DOCTYPE html><html><body>
    <div id="write">
      <h2 mdtype="heading" cid="h1"><span>Section</span></h2>
      <p cid="p1">Body</p>
      <h3 mdtype="heading" cid="h2">Child</h3>
      <p cid="p2">Child body</p>
      <h2 mdtype="heading" cid="h3">Next section</h2>
      <p cid="p3">Next body</p>
    </div>
  </body></html>`, { url: "http://localhost/" })

  global.window = dom.window
  global.document = dom.window.document
  global.File = { isMac: true, option: {} }
  global.$ = () => ({})

  const eWrite = document.querySelector("#write")
  const config = {
    STRICT_MODE: true,
    STRICT_MODE_IN_CONTEXT_MENU: false,
    RECORD_COLLAPSE: true,
    MODIFIER_KEY: {
      COLLAPSE_SINGLE: "ctrl",
      COLLAPSE_SIBLINGS: "",
      COLLAPSE_ALL_SIBLINGS: "",
      COLLAPSE_RECURSIVE: "",
    },
  }
  const i18n = { fillActions: actions => actions }
  const plugin = new CollapseParagraphPlugin("collapse_paragraph", config, i18n)
  plugin.utils = {
    callPluginFunction: mock.fn(),
    settings: { autoSave: mock.fn() },
    stateRecorder: { register: mock.fn(), unregister: mock.fn() },
    entities: {
      eWrite,
      querySelectorInWrite: (...args) => eWrite.querySelector(...args),
      querySelectorAllInWrite: (...args) => eWrite.querySelectorAll(...args),
    },
    modifierKey: keyString => {
      const keys = keyString.toLowerCase().split("+").map(k => k.trim())
      const ctrl = keys.includes("ctrl")
      const shift = keys.includes("shift")
      const alt = keys.includes("alt")
      return ev => ev.shiftKey === shift && ev.altKey === alt && ev.metaKey === ctrl
    },
  }

  return { dom, plugin }
}

describe("macOS collapse_paragraph adapter", () => {
  beforeEach(() => {
    delete global.window
    delete global.document
    delete global.File
    delete global.$
  })

  it("initializes when the upstream .sidebar-menu node is missing", () => {
    const { plugin } = createPlugin()

    assert.doesNotThrow(() => plugin.process())
    assert.strictEqual(plugin.utils.settings.autoSave.mock.callCount(), 1)
    assert.strictEqual(plugin.utils.stateRecorder.register.mock.callCount(), 1)
  })

  it("maps the upstream ctrl-click setting to macOS Command-click", () => {
    const { plugin } = createPlugin()
    plugin.process()

    const heading = document.querySelector("[cid='h1']")
    heading.querySelector("span").dispatchEvent(new window.MouseEvent("click", {
      bubbles: true,
      metaKey: true,
    }))

    assert.ok(heading.classList.contains(plugin.className))
    assert.strictEqual(document.querySelector("[cid='p1']").style.display, "none")
    assert.strictEqual(document.querySelector("[cid='h2']").style.display, "none")
    assert.strictEqual(document.querySelector("[cid='p3']").style.display, "")
    assert.strictEqual(plugin.utils.callPluginFunction.mock.callCount(), 1)
  })

  it("collapses on mousedown capture and suppresses the following click", () => {
    const { plugin } = createPlugin()
    plugin.process()

    const heading = document.querySelector("[cid='h1']")
    const eventInit = {
      bubbles: true,
      cancelable: true,
      metaKey: true,
      button: 0,
    }
    heading.querySelector("span").dispatchEvent(new window.MouseEvent("mousedown", eventInit))
    heading.querySelector("span").dispatchEvent(new window.MouseEvent("click", eventInit))

    assert.ok(heading.classList.contains(plugin.className))
    assert.strictEqual(document.querySelector("[cid='p1']").style.display, "none")
    assert.strictEqual(plugin.utils.callPluginFunction.mock.callCount(), 1)
  })

  it("recognizes macOS heading tags even when mdtype is missing", () => {
    const { plugin } = createPlugin()
    const heading = document.querySelector("[cid='h1']")
    heading.removeAttribute("mdtype")
    plugin.process()

    heading.querySelector("span").dispatchEvent(new window.MouseEvent("mousedown", {
      bubbles: true,
      metaKey: true,
      button: 0,
    }))

    assert.ok(heading.classList.contains(plugin.className))
    assert.strictEqual(document.querySelector("[cid='p1']").style.display, "none")
  })
})
