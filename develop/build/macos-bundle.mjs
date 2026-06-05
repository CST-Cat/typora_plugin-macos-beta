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

const SHIM_MODULES = new Set([
  "path",
  "fs",
  "fs-extra",
  "os",
  "child_process",
  "electron",
])

const UNSUPPORTED_MODULES = new Set([
  "assert",
  "buffer",
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
  "url",
  "util",
  "worker_threads",
  "zlib",
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
  const foldDir = join(PLUGIN_DIR, "fence_enhance/resource/fold")
  if (!existsSync(foldDir)) return []
  return readdirSync(foldDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".js"))
    .map(entry => [entry.name.replace(/\.js$/, ""), join(foldDir, entry.name)])
}

function createRegistryModule() {
  const entries = [...discoverBasePlugins(), ...discoverResourceModules()]
    .map(([name, file]) => `  ${JSON.stringify(name)}: () => require(${JSON.stringify(file)}),`)
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
