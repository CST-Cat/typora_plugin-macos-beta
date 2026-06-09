const original = require("../../markmap/index.js")
const MarkmapPlugin = original.plugin

const LOCAL_RESOURCE_TYPES = [
  { expectedType: "stylesheet", urlProp: "href" },
  { expectedType: "script", urlProp: "src" },
]

const toFileUrl = file => `file://${String(file).split("/").map(encodeURIComponent).join("/")}`

const isLocalAbsolutePath = url => typeof url === "string" && url.startsWith("/") && !url.startsWith("//")

const normalizeLocalResourceUrls = (items = []) => {
  for (const item of items) {
    const rule = LOCAL_RESOURCE_TYPES.find(({ expectedType, urlProp }) =>
      item?.type === expectedType && typeof item?.data?.[urlProp] === "string",
    )
    if (!rule) continue

    const url = item.data[rule.urlProp]
    if (isLocalAbsolutePath(url)) {
      item.data[rule.urlProp] = toFileUrl(url)
    }
  }
}

const inlineLocalResources = async (styles = [], scripts = [], readFile) => {
  if (typeof readFile !== "function") {
    normalizeLocalResourceUrls(styles)
    normalizeLocalResourceUrls(scripts)
    return
  }

  for (const item of styles) {
    const href = item?.type === "stylesheet" ? item.data?.href : null
    if (!isLocalAbsolutePath(href)) continue
    item.type = "style"
    item.data = await readFile(href, "utf-8")
  }

  for (const item of scripts) {
    const src = item?.type === "script" ? item.data?.src : null
    if (!isLocalAbsolutePath(src)) continue
    item.data = { textContent: await readFile(src, "utf-8") }
  }
}

class MacosMarkmapPlugin extends MarkmapPlugin {
  constructor(...args) {
    super(...args)
    const originalLocalizeResources = this.localizeResources.bind(this)
    this._macosOriginalLocalizeResources = originalLocalizeResources
    this.localizeResources = (styles = [], scripts = []) => {
      originalLocalizeResources(styles, scripts)
      normalizeLocalResourceUrls(styles)
      normalizeLocalResourceUrls(scripts)
    }
  }

  lazyLoad = async () => {
    if (this.Lib.transformerVersions) return

    const { Transformer, transformerVersions, markmap } = require("../../markmap/resource/markmap.min.js")
    const transformer = new Transformer()
    Object.assign(this.Lib, markmap, { transformer, Transformer, transformerVersions })

    const { styles, scripts } = transformer.getAssets()
    this._macosOriginalLocalizeResources(styles, scripts)

    const readFile = this.utils?.Package?.FsExtra?.readFile
    await inlineLocalResources(styles, scripts, readFile?.bind(this.utils.Package.FsExtra))

    await markmap.loadCSS(styles)
    await markmap.loadJS(scripts, { getMarkmap: () => markmap })
  }
}

module.exports = {
  ...original,
  plugin: MacosMarkmapPlugin,
  MacosMarkmapPlugin,
  inlineLocalResources,
  normalizeLocalResourceUrls,
}
