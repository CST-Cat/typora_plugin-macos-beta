const { describe, it, mock } = require("node:test")
const assert = require("node:assert/strict")

const DiagramParser = require("../../plugin/global/core/utils/diagramParser.js")

function collection(length, methods = {}) {
  return {
    length,
    html(value) {
      methods.html?.(value)
      return this
    },
    text(value) {
      methods.text?.(value)
      return this
    },
    show() {
      methods.show?.()
      return this
    },
  }
}

function createFakePre() {
  const state = {
    panel: false,
    errorPre: false,
    header: "",
    preview: "",
    error: "",
    classes: new Set(),
  }
  const pre = {
    state,
    find(selector) {
      if (selector === ".md-diagram-panel") {
        return collection(state.panel ? 1 : 0)
      }
      if (selector === ".md-diagram-panel-error pre") {
        return collection(state.errorPre ? 1 : 0)
      }
      if (selector === ".md-diagram-panel-header") {
        return collection(1, {
          html: value => { state.header = value },
          text: value => { state.header = value },
        })
      }
      if (selector === ".md-diagram-panel-preview") {
        return collection(1, {
          html: value => { state.preview = value },
          text: value => { state.preview = value },
        })
      }
      if (selector === ".md-diagram-panel-error") {
        return collection(1, {
          html: value => {
            state.error = value
            state.errorPre = typeof value === "string" && value.includes("<pre>")
          },
        })
      }
      return collection(0)
    },
    append() {
      state.panel = true
      return pre
    },
    addClass(classNames) {
      classNames.split(/\s+/).filter(Boolean).forEach(name => state.classes.add(name))
      return pre
    },
  }
  return pre
}

function createParser(renderFunc, getContent) {
  const parser = new DiagramParser({
    getFenceContentByCid: getContent,
    escape: text => String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
  }, {
    t: () => "Failed to render the chart",
  })
  parser.parsers.set("marp", {
    lang: "marp",
    destroyWhenUpdate: false,
    renderFunc,
  })
  return parser
}

describe("DiagramParser render cache", () => {
  it("includes the Error message when a browser stack omits it", () => {
    const parser = createParser(async () => {}, () => "")
    const error = new Error("drawio failed")
    error.stack = "@file:///entry.bundle.js:1:2"

    const message = parser.getErrorMessage(error)
    assert.match(message, /Error: drawio failed/)
    assert.match(message, /@file:\/\/\/entry\.bundle\.js:1:2/)
  })

  it("skips re-rendering unchanged failed diagrams and preserves the error panel", async () => {
    let content = "---\nmarp: true\n---\n# Slide"
    const renderFunc = mock.fn(async () => {
      throw new Error("marp failed")
    })
    const pre = createFakePre()
    const parser = createParser(renderFunc, () => content)

    await parser.renderCustomDiagram("cid-1", "marp", pre)
    assert.equal(renderFunc.mock.callCount(), 1)
    assert.equal(pre.state.errorPre, true)
    const firstError = pre.state.error

    await parser.renderCustomDiagram("cid-1", "marp", pre)
    assert.equal(renderFunc.mock.callCount(), 1)
    assert.equal(pre.state.error, firstError)

    content = "---\nmarp: true\n---\n# Changed"
    await parser.renderCustomDiagram("cid-1", "marp", pre)
    assert.equal(renderFunc.mock.callCount(), 2)
  })
})
