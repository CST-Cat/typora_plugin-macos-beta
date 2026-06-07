global.BasePlugin = class {
}

const { describe, it, beforeEach, mock } = require("node:test")
const assert = require("node:assert")
const { MacosTabManager, resolveMacosTabMoveIndex } = require("../../plugin/macos/adapters/window_tab.js")

const rects = [
  { left: 0, width: 100 },
  { left: 100, width: 100 },
  { left: 200, width: 100 },
  { left: 300, width: 100 },
]

describe("macOS window_tab adapter", () => {
  let context
  let manager

  beforeEach(() => {
    context = {
      utils: {
        openFile: mock.fn(),
        existPath: mock.fn(),
        showMessageBox: mock.fn(),
        getFileName: p => p.split("/").pop(),
        separator: "/",
      },
      i18n: {
        t: key => key,
      },
      config: {
        NEW_TAB_POSITION: "end",
        MAX_TAB_NUM: 0,
        TAB_SWITCH_ON_CLOSE: "right",
        LAST_TAB_CLOSE_ACTION: "reconfirm",
        SHOW_DIR_ON_DUPLICATE: true,
        TRIM_FILE_EXT: false,
      },
      onRender: mock.fn(),
      onBeforeSwitch: mock.fn(),
      onEmpty: mock.fn(),
      onExit: mock.fn(),
    }
    manager = new MacosTabManager(context)
  })

  it("notifies before switching away from the current tab", () => {
    manager.reset([{ path: "/a" }, { path: "/b" }])
    manager.switch(1)

    assert.strictEqual(context.onBeforeSwitch.mock.callCount(), 1)
    assert.strictEqual(context.onBeforeSwitch.mock.calls[0].arguments[0].path, "/a")
    assert.strictEqual(context.onBeforeSwitch.mock.calls[0].arguments[1].path, "/b")
  })

  it("preserves macOS scroll anchor metadata while restoring a session", () => {
    const saveTabs = [
      { path: "/exist.md", scrollTop: 100, scrollAnchor: { cid: "a", offsetTop: -12 }, scrollRatio: 0.2, active: false },
      { path: "/restored.md", scrollTop: 50, scrollAnchor: { cid: "b", offsetTop: 8 }, scrollRatio: 0.6, active: true },
    ]

    manager.restoreSession(saveTabs, "root", "root", true)

    assert.strictEqual(manager.count, 2)
    assert.deepStrictEqual(manager.tabs[0].scrollAnchor, { cid: "a", offsetTop: -12 })
    assert.strictEqual(manager.tabs[0].scrollRatio, 0.2)
    assert.deepStrictEqual(manager.tabs[1].scrollAnchor, { cid: "b", offsetTop: 8 })
    assert.strictEqual(manager.tabs[1].scrollRatio, 0.6)
    assert.strictEqual(manager.activeIdx, 1)
  })

  it("resolves mouse-drag drop positions after removing the dragged tab", () => {
    assert.strictEqual(resolveMacosTabMoveIndex(rects, 0, 210), 1)
    assert.strictEqual(resolveMacosTabMoveIndex(rects, 0, 260), 2)
    assert.strictEqual(resolveMacosTabMoveIndex(rects, 0, 390), 3)
    assert.strictEqual(resolveMacosTabMoveIndex(rects, 3, 120), 1)
    assert.strictEqual(resolveMacosTabMoveIndex(rects, 2, -20), 0)
  })
})
