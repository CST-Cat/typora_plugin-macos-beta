global.BasePlugin = class {
  constructor(fixedName, config, i18n) {
    this.fixedName = fixedName
    this.config = config
    this.i18n = i18n
  }
}

const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const {
  inlineLocalResources,
  plugin: MarkmapPlugin,
} = require("../../plugin/macos/adapters/markmap.js")

const createPlugin = () => {
  const plugin = new MarkmapPlugin("markmap", {
    ENABLE_TOC_MARKMAP: false,
    ENABLE_FENCE_MARKMAP: false,
  }, { fillActions: actions => actions })
  const root = "/Users/cat/Library/Application Support/abnerworks.Typora/plugins/typora_plugin"
  plugin.utils = {
    joinPluginPath: (...parts) => path.posix.join(root, ...parts),
  }
  return plugin
}

describe("macOS markmap adapter", () => {
  it("converts localized resources to file URLs for WebKit", () => {
    const plugin = createPlugin()
    const styles = [
      { type: "stylesheet", data: { href: "https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" } },
      { type: "stylesheet", data: { href: "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.8.0/styles/default.min.css" } },
      { type: "stylesheet", data: { href: "https://example.test/unchanged.css" } },
    ]
    const scripts = [
      { type: "script", data: { src: "https://cdn.jsdelivr.net/npm/webfontloader@1.6.28/webfontloader.js" } },
      { type: "iife", data: {} },
    ]

    plugin.localizeResources(styles, scripts)

    assert.equal(styles[0].data.href, "file:///Users/cat/Library/Application%20Support/abnerworks.Typora/plugins/typora_plugin/plugin/global/core/lib/katex/katex.min.css")
    assert.equal(styles[1].data.href, "file:///Users/cat/Library/Application%20Support/abnerworks.Typora/plugins/typora_plugin/plugin/markmap/resource/default.min.css")
    assert.equal(styles[2].data.href, "https://example.test/unchanged.css")
    assert.equal(scripts[0].data.src, "file:///Users/cat/Library/Application%20Support/abnerworks.Typora/plugins/typora_plugin/plugin/markmap/resource/webfontloader.js")
  })

  it("inlines localized local resources before Markmap loads them", async () => {
    const styles = [
      { type: "stylesheet", data: { href: "/Users/cat/plugin/global/core/lib/katex/katex.min.css" } },
      { type: "stylesheet", data: { href: "https://example.test/remote.css" } },
    ]
    const scripts = [
      { type: "script", data: { src: "/Users/cat/plugin/markmap/resource/webfontloader.js" } },
      { type: "script", data: { src: "https://example.test/remote.js" } },
    ]
    const readFile = async file => `contents of ${file}`

    await inlineLocalResources(styles, scripts, readFile)

    assert.deepEqual(styles[0], {
      type: "style",
      data: "contents of /Users/cat/plugin/global/core/lib/katex/katex.min.css",
    })
    assert.equal(styles[1].data.href, "https://example.test/remote.css")
    assert.deepEqual(scripts[0], {
      type: "script",
      data: { textContent: "contents of /Users/cat/plugin/markmap/resource/webfontloader.js" },
    })
    assert.equal(scripts[1].data.src, "https://example.test/remote.js")
  })
})
