import { build } from "esbuild"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { existsSync, readdirSync, readFileSync } from "node:fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = resolve(__dirname, "../..")
const PLUGIN_DIR = join(ROOT, "plugin")
const MACOS_DIR = join(PLUGIN_DIR, "macos")
const OUTFILE = join(MACOS_DIR, "entry.bundle.js")
const ENTRY = join(MACOS_DIR, "bundle-entry.js")
const SETTINGS = join(PLUGIN_DIR, "global/settings/settings.default.toml")
const SHIMS = join(MACOS_DIR, "shared-shims.js")
const DRAWIO_ENTRY = join(PLUGIN_DIR, "drawIO.js")
const MARP_ENTRY = join(PLUGIN_DIR, "marp/index.js")
const MACOS_ADAPTER_DIR = join(MACOS_DIR, "adapters")

const MACOS_PLUGIN_ADAPTERS = new Map([
  ["commander", join(MACOS_ADAPTER_DIR, "commander.js")],
  ["command_palette", join(MACOS_ADAPTER_DIR, "command_palette.js")],
  ["image_viewer", join(MACOS_ADAPTER_DIR, "image_viewer.js")],
  ["markdownlint", join(MACOS_ADAPTER_DIR, "markdownlint.js")],
  ["right_click_menu", join(MACOS_ADAPTER_DIR, "right_click_menu.js")],
  ["sidebar_enhance", join(MACOS_ADAPTER_DIR, "sidebar_enhance.js")],
  ["window_tab", join(MACOS_ADAPTER_DIR, "window_tab.js")],
])

const SHIM_MODULES = new Set([
  "buffer",
  "path",
  "fs",
  "fs-extra",
  "os",
  "url",
  "util",
  "child_process",
  "electron",
])

const UNSUPPORTED_MODULES = new Set([
  "assert",
  "crypto",
  "events",
  "extract-zip",
  "http",
  "https",
  "net",
  "process",
  "stream",
  "tls",
  "tty",
  "worker_threads",
  "chromedriver",
  "debug",
  "electron-fetch",
  "getos",
  "glob",
  "hjson",
  "iconv-lite",
  "jschardet",
  "native-reg",
  "node-machine-id",
  "node-notifier",
  "selenium-webdriver",
  "spellchecker",
  "vscode-ripgrep",
])

function readConfiguredPluginNames() {
  const text = readFileSync(SETTINGS, "utf-8")
  const names = []
  const seen = new Set()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\[([A-Za-z0-9_]+)]\s*$/.exec(line)
    if (!match) continue
    const name = match[1]
    if (name === "global" || seen.has(name)) continue
    seen.add(name)
    names.push(name)
  }
  return names
}

function pluginEntrypoint(name) {
  const file = join(PLUGIN_DIR, `${name}.js`)
  if (existsSync(file)) return file
  const index = join(PLUGIN_DIR, name, "index.js")
  if (existsSync(index)) return index
  return null
}

function discoverBasePlugins() {
  const fromSettings = readConfiguredPluginNames()
    .map(name => [name, pluginEntrypoint(name)])
    .filter(([, file]) => file)

  const seen = new Set(fromSettings.map(([name]) => name))
  const fromFiles = readdirSync(PLUGIN_DIR, { withFileTypes: true })
    .flatMap(entry => {
      if (entry.name.startsWith(".")) return []
      const name = entry.isFile() && entry.name.endsWith(".js")
        ? entry.name.replace(/\.js$/, "")
        : entry.isDirectory()
          ? entry.name
          : null
      if (!name || name === "index" || name === "global" || name === "macos" || name === "bin") return []
      if (seen.has(name)) return []
      const file = pluginEntrypoint(name)
      if (!file) return []
      seen.add(name)
      return [[name, file]]
    })

  return [...fromSettings, ...fromFiles].sort(([a], [b]) => a.localeCompare(b))
}

function discoverResourceModules() {
  const resourceDirs = [
    {
      dir: join(PLUGIN_DIR, "fence_enhance/resource/fold"),
      filter: entry => entry.isFile() && entry.name.endsWith(".js"),
    },
    {
      dir: join(PLUGIN_DIR, "wavedrom"),
      filter: entry => entry.isFile()
        && entry.name.endsWith(".js")
        && !["index.js", "wavedrom.min.js"].includes(entry.name),
    },
  ]

  return resourceDirs.flatMap(({ dir, filter }) => {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter(filter)
      .map(entry => [entry.name.replace(/\.js$/, ""), join(dir, entry.name)])
  })
}

function createRegistryModule() {
  const entries = [...discoverBasePlugins(), ...discoverResourceModules()]
    .map(([name, file]) => {
      const modulePath = name === "drawIO"
        ? "macos-drawio-adapter"
        : name === "marp"
          ? "macos-marp-adapter"
          : MACOS_PLUGIN_ADAPTERS.get(name) || file
      return `  ${JSON.stringify(name)}: () => require(${JSON.stringify(modulePath)}),`
    })
    .join("\n")
  return `module.exports = {\n${entries}\n}\n`
}

function createUnsupportedModule(name) {
  const message = `Module is not available in macOS WebKit mode: ${name}`
  return `
    const fail = () => { throw new Error(${JSON.stringify(message)}) }
    module.exports = new Proxy(fail, {
      apply: fail,
      construct: fail,
      get: (_target, prop) => {
        if (prop === "__esModule") return false
        if (prop === "default") return fail
        return fail()
      },
    })
  `
}

function macosBuildPlugin() {
  return {
    name: "typora-plugin-macos",
    setup(builder) {
      builder.onResolve({ filter: /^macos-plugin-registry$/ }, () => ({
        path: "macos-plugin-registry",
        namespace: "macos-virtual",
      }))

      builder.onResolve({ filter: /^macos-drawio-adapter$/ }, () => ({
        path: "macos-drawio-adapter",
        namespace: "macos-virtual",
      }))

      builder.onResolve({ filter: /^macos-marp-adapter$/ }, () => ({
        path: "macos-marp-adapter",
        namespace: "macos-virtual",
      }))

      builder.onResolve({ filter: /^zlib$/ }, () => ({
        path: "zlib",
        namespace: "macos-zlib",
      }))

      builder.onResolve({ filter: /^[^./].*/ }, (args) => {
        if (SHIM_MODULES.has(args.path)) {
          return { path: args.path, namespace: "macos-shim" }
        }
        if (UNSUPPORTED_MODULES.has(args.path) || args.path.startsWith("selenium-webdriver/")) {
          return { path: args.path, namespace: "macos-unsupported" }
        }
        return null
      })

      builder.onLoad({ filter: /^macos-plugin-registry$/, namespace: "macos-virtual" }, () => ({
        contents: createRegistryModule(),
        loader: "js",
        resolveDir: ROOT,
      }))

      builder.onLoad({ filter: /^macos-drawio-adapter$/, namespace: "macos-virtual" }, () => ({
        contents: `
          const original = require(${JSON.stringify(DRAWIO_ENTRY)})
          const DrawIOPlugin = original.plugin

          const compactGraphConfig = graphConfig => Object.fromEntries(
            Object.entries(graphConfig).filter(([, value]) => value !== null && value !== undefined),
          )

          const assertGraphViewer = () => {
            if (!window.GraphViewer || typeof window.GraphViewer.processElements !== "function") {
              throw new Error("Draw.io viewer is not loaded. Check drawIO.RESOURCE_URI.")
            }
          }

          const fallbackSanitizeHtml = (utils, value) => {
            if (value?.nodeType) return value
            if (typeof value === "string") return utils.escape(value).replace(/\\r?\\n/g, "<br>")
            if (value?.textContent) return utils.escape(value.textContent).replace(/\\r?\\n/g, "<br>")
            return ""
          }

          const patchSanitizer = (utils) => {
            const graph = window.Graph
            if (!graph || graph.__typoraPluginMacosSanitizerPatched || typeof graph.domPurify !== "function") return

            graph.domPurify = (value, inPlace) => fallbackSanitizeHtml(utils, value, inPlace)
            graph.__typoraPluginMacosSanitizerPatched = true
          }

          const createRenderer = plugin => async (container, mxGraphData) => {
            assertGraphViewer()
            const jsonStr = JSON.stringify(compactGraphConfig(mxGraphData))
            const escaped = plugin.utils.escape(jsonStr)
            container.innerHTML = \`<div class="mxgraph" style="max-width:100%; margin: 26px auto 0;" data-mxgraph="\${escaped}"></div>\`
            await plugin.utils.sleep(0)
            const graph = container.querySelector(".mxgraph")
            try {
              if (typeof window.GraphViewer.createViewerForElement === "function") {
                window.GraphViewer.createViewerForElement(graph)
              } else {
                window.GraphViewer.processElements()
              }
            } catch (error) {
              throw new Error(\`Draw.io viewer failed: \${error.message || error}\\n\${error.stack || ""}\`)
            }
            await plugin.utils.sleep(50)
            if (container.textContent?.trim() === "Type error") {
              throw new Error("Draw.io viewer failed with Type error. Check the graphConfig XML/source format.")
            }
            return container
          }

          class MacosDrawIOPlugin extends DrawIOPlugin {
            constructor(...args) {
              super(...args)
              const originalLazyLoad = this.lazyLoad
              this.INTERACTION_TYPE = {
                ...this.INTERACTION_TYPE,
                showOnly: { highlight: "#0000ff", nav: false, edit: null, editable: false, lightbox: false },
              }
              this._render = createRenderer(this)
              this.lazyLoad = async () => {
                await originalLazyLoad()
                assertGraphViewer()
                patchSanitizer(this.utils)
                window.GraphViewer.prototype.toolbarZIndex = 7
              }
            }
          }

          module.exports = { ...original, plugin: MacosDrawIOPlugin }
        `,
        loader: "js",
        resolveDir: ROOT,
      }))

      builder.onLoad({ filter: /^macos-marp-adapter$/, namespace: "macos-virtual" }, () => ({
        contents: `
          const original = require(${JSON.stringify(MARP_ENTRY)})
          const MarpPlugin = original.plugin

          const RESPONSIVE_STYLE = \`
            :host {
              display: block;
              width: 100%;
              max-width: 100%;
              overflow-x: hidden;
            }

            .marpit {
              display: grid;
              justify-items: center;
              gap: 1.25rem;
              width: 100%;
              max-width: 100%;
              overflow-x: hidden;
            }

            .marpit > svg[data-marpit-svg] {
              display: block;
              width: 100% !important;
              max-width: 100% !important;
              height: auto !important;
              margin: 0 auto !important;
              box-sizing: border-box;
              background: #fff;
              border: 1px solid rgba(31, 41, 55, 0.16);
              border-radius: 4px;
              box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
            }
          \`

          const installResponsiveStyle = (root) => {
            if (!root || typeof root.querySelector !== "function") return
            if (root.querySelector("style[data-typora-plugin-macos-marp-responsive]")) return
            const style = document.createElement("style")
            style.dataset.typoraPluginMacosMarpResponsive = "true"
            style.textContent = RESPONSIVE_STYLE
            root.prepend(style)
          }

          const prepareHost = (host) => {
            if (!host?.style) return
            host.style.width = "100%"
            host.style.maxWidth = "100%"
            host.style.overflowX = "hidden"
          }

          const fitSlides = (host, root) => {
            const update = () => {
              if (!root || typeof root.querySelectorAll !== "function") return
              for (const svg of root.querySelectorAll("svg[data-marpit-svg]")) {
                const viewBox = svg.viewBox?.baseVal
                const rect = svg.getBoundingClientRect()
                if (!viewBox?.width || !viewBox?.height || !rect.width) continue

                const sections = [...svg.querySelectorAll("foreignObject > section")]
                const marpPolyfillActive = sections.some(section => section.style.transform?.includes("matrix("))
                if (marpPolyfillActive) continue

                const scale = rect.width / viewBox.width
                svg.style.height = \`\${viewBox.height * scale}px\`

                for (const section of sections) {
                  section.style.width = \`\${viewBox.width}px\`
                  section.style.height = \`\${viewBox.height}px\`
                  section.style.transformOrigin = "0 0"
                  section.style.transform = \`scale(\${scale})\`
                }
              }
            }

            host.__typoraPluginMacosMarpResizeObserver?.disconnect()
            const observer = new ResizeObserver(update)
            host.__typoraPluginMacosMarpResizeObserver = observer
            observer.observe(host)
            for (const svg of root.querySelectorAll("svg[data-marpit-svg]")) observer.observe(svg)

            update()
            requestAnimationFrame(update)
            setTimeout(update, 50)
            setTimeout(update, 250)
          }

          const runEmbeddedScripts = (root) => {
            if (!root || typeof root.querySelectorAll !== "function") return
            for (const inertScript of [...root.querySelectorAll("script")]) {
              const script = document.createElement("script")
              for (const { name, value } of inertScript.attributes) {
                script.setAttribute(name, value)
              }
              script.textContent = inertScript.textContent
              inertScript.replaceWith(script)
            }
          }

          const patchMathJaxLoader = () => {
            const mathJax = typeof globalThis !== "undefined" ? globalThis.MathJax : null
            if (!mathJax?.loader || typeof mathJax.loader.preLoad === "function") return
            try {
              mathJax.loader.preLoad = () => {}
            } catch {
              globalThis.MathJax = {
                ...mathJax,
                loader: {
                  ...mathJax.loader,
                  preLoad: () => {},
                },
              }
            }
          }

          const createAbsoluteImagePathRule = plugin => {
            const toAbsPath = (url) => {
              let decodedURL = url
              try {
                decodedURL = decodeURIComponent(url)
              } catch {}
              const dir = plugin.utils.getLocalRootUrl()
              const absPath = (plugin.utils.isNetworkImage(decodedURL) || plugin.utils.isSpecialImage(decodedURL))
                ? decodedURL
                : plugin.utils.Package.Path.resolve(dir, decodedURL)
              return absPath.split(plugin.utils.Package.Path.sep).join("/")
            }

            return function (marp) {
              const originalNormalizeLink = marp.normalizeLink
              marp.normalizeLink = (url) => {
                const normalized = originalNormalizeLink(url)
                return toAbsPath(normalized)
              }
              const originalImageRule = marp.renderer.rules.image

              marp.renderer.rules.image = (tokens, idx, options, env, self) => {
                const token = tokens[idx]
                const srcIndex = token.attrIndex("src")
                if (srcIndex >= 0) {
                  token.attrs[srcIndex][1] = toAbsPath(token.attrs[srcIndex][1])
                }
                return originalImageRule ? originalImageRule(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
              }
            }
          }

          class MacosMarpPlugin extends MarpPlugin {
            constructor(...args) {
              super(...args)
              const originalLazyLoad = this.lazyLoad
              this._marpAbsoluteImagePath = () => createAbsoluteImagePathRule(this)
              this.lazyLoad = () => {
                patchMathJaxLoader()
                originalLazyLoad()
                if (!this.marp || typeof this.marp.render !== "function") {
                  throw new Error("Failed to initialize Marp core.")
                }
              }
              this.create = ($wrap, content) => {
                if (!this.marp) {
                  throw new Error("Marp core is not initialized.")
                }
                const { html, css } = this.marp.render(content)
                const host = $wrap[0]
                const root = host.shadowRoot || (typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host)
                root.innerHTML = \`<style>\${css}</style>\` + html
                prepareHost(host)
                installResponsiveStyle(root)
                runEmbeddedScripts(root)
                fitSlides(host, root)
                return root
              }
              this.destroy = root => {
                const host = root?.host || root
                host?.__typoraPluginMacosMarpResizeObserver?.disconnect()
                if (root) root.innerHTML = ""
              }
            }
          }

          module.exports = { ...original, plugin: MacosMarpPlugin }
        `,
        loader: "js",
        resolveDir: ROOT,
      }))

      builder.onLoad({ filter: /^zlib$/, namespace: "macos-zlib" }, () => ({
        contents: `
          const { deflateSync, strToU8 } = require("fflate")

          const bytesToBase64 = bytes => {
            let binary = ""
            const chunkSize = 0x8000
            for (let i = 0; i < bytes.length; i += chunkSize) {
              binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
            }
            return btoa(binary)
          }

          const toBytes = input => {
            if (typeof input === "string") return strToU8(input)
            if (input instanceof Uint8Array) return input
            if (input instanceof ArrayBuffer) return new Uint8Array(input)
            if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
            return strToU8(String(input))
          }

          const toBufferLike = bytes => ({
            length: bytes.length,
            byteLength: bytes.byteLength,
            toString: encoding => {
              if (encoding === "base64") return bytesToBase64(bytes)
              return new TextDecoder("utf-8").decode(bytes)
            },
            valueOf: () => bytes,
            [Symbol.iterator]: () => bytes[Symbol.iterator](),
          })

          module.exports = {
            deflateRawSync: input => toBufferLike(deflateSync(toBytes(input))),
          }
        `,
        loader: "js",
        resolveDir: __dirname,
      }))

      builder.onLoad({ filter: /.*/, namespace: "macos-shim" }, (args) => ({
        contents: `module.exports = window.__TP_MACOS__.shims[${JSON.stringify(args.path)}]\n`,
        loader: "js",
      }))

      builder.onLoad({ filter: /.*/, namespace: "macos-unsupported" }, (args) => ({
        contents: createUnsupportedModule(args.path),
        loader: "js",
      }))
    },
  }
}

await build({
  entryPoints: [ENTRY],
  outfile: OUTFILE,
  bundle: true,
  platform: "browser",
  target: ["safari17"],
  format: "iife",
  minify: false,
  sourcemap: false,
  banner: {
    js: readFileSync(SHIMS, "utf-8"),
  },
  define: {
    global: "globalThis",
    "process.env.NODE_ENV": '"production"',
  },
  plugins: [macosBuildPlugin()],
  logLevel: "info",
})

console.log(`macOS bundle written to ${OUTFILE}`)
