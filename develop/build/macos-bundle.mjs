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
