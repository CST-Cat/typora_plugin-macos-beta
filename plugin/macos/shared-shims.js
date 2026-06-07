;(() => {
  "use strict"

  const existing = globalThis.__TP_MACOS__
  if (existing?.version) return

  const version = "1.0.0"
  if (!globalThis.global) globalThis.global = globalThis
  if (!globalThis.CSS) globalThis.CSS = {}
  if (!globalThis.CSS.escape) {
    globalThis.CSS.escape = value => String(value).replace(/[\0-\x1f\x7f!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, "\\$&")
  }

  const ua = navigator.userAgent || ""
  const isMacOS = /Mac OS X|Macintosh/.test(ua)
  const isElectron = !!globalThis.process?.versions?.electron
  const isWebKit = isMacOS && !isElectron && typeof globalThis.JSBridge !== "undefined"

  const currentScript = document.currentScript
  const scriptUrl = new URL(currentScript?.src || location.href)
  const macosDirUrl = new URL(".", scriptUrl)
  const pluginDirUrl = new URL("../", macosDirUrl)
  const pluginRootUrl = new URL("../", pluginDirUrl)
  const connectionUrl = new URL("helper/connection.json", macosDirUrl)
  const injectedConnection = globalThis.__TP_MACOS_CONNECTION__ || {}

  const toPath = (url) => decodeURIComponent(url.pathname)
  const pluginRoot = String(injectedConnection.pluginRoot || toPath(pluginRootUrl)).replace(/\/$/, "")
  const coreDir = `${pluginRoot}/plugin/global/core`
  const connectionPath = toPath(connectionUrl)

  const nativeProcess = globalThis.process || {}
  globalThis.process = {
    ...nativeProcess,
    env: nativeProcess.env || {},
    platform: "darwin",
    versions: {
      ...(nativeProcess.versions || {}),
      node: nativeProcess.versions?.node || undefined,
    },
  }

  const normalizePath = (input) => {
    if (!input) return "."
    const value = String(input).replace(/\\/g, "/")
    const absolute = value.startsWith("/")
    const parts = []
    for (const part of value.split("/")) {
      if (!part || part === ".") continue
      if (part === "..") {
        if (parts.length && parts[parts.length - 1] !== "..") parts.pop()
        else if (!absolute) parts.push(part)
      } else {
        parts.push(part)
      }
    }
    const joined = parts.join("/")
    return absolute ? `/${joined}` : joined || "."
  }

  const pathShim = {
    sep: "/",
    delimiter: ":",
    join: (...parts) => normalizePath(parts.filter(part => part !== "").join("/")),
    resolve: (...parts) => {
      let resolved = ""
      for (const part of parts) {
        if (part == null || part === "") continue
        const value = String(part)
        resolved = value.startsWith("/") ? value : `${resolved || pluginRoot}/${value}`
      }
      return normalizePath(resolved || pluginRoot)
    },
    dirname: (file) => {
      const normalized = normalizePath(file)
      const idx = normalized.lastIndexOf("/")
      if (idx < 0) return "."
      if (idx === 0) return "/"
      return normalized.slice(0, idx)
    },
    basename: (file, ext = "") => {
      const normalized = normalizePath(file)
      const idx = normalized.lastIndexOf("/")
      let base = idx < 0 ? normalized : normalized.slice(idx + 1)
      if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length)
      return base
    },
    extname: (file) => {
      const base = pathShim.basename(file)
      const idx = base.lastIndexOf(".")
      return idx <= 0 ? "" : base.slice(idx)
    },
    isAbsolute: (file) => typeof file === "string" && file.startsWith("/"),
    normalize: normalizePath,
    relative: (from, to) => {
      const fromParts = normalizePath(from).split("/").filter(Boolean)
      const toParts = normalizePath(to).split("/").filter(Boolean)
      while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
        fromParts.shift()
        toParts.shift()
      }
      return [...fromParts.map(() => ".."), ...toParts].join("/") || ""
    },
    parse: (file) => {
      const normalized = normalizePath(file)
      const dir = pathShim.dirname(normalized)
      const base = pathShim.basename(normalized)
      const ext = pathShim.extname(base)
      return {
        root: normalized.startsWith("/") ? "/" : "",
        dir,
        base,
        ext,
        name: ext ? base.slice(0, -ext.length) : base,
      }
    },
    format: (object) => {
      const dir = object.dir || object.root || ""
      const base = object.base || `${object.name || ""}${object.ext || ""}`
      return dir === "/" ? `/${base}` : dir ? `${dir}/${base}` : base
    },
  }
  pathShim.posix = pathShim

  const pathToFileURL = (file) => {
    const resolved = pathShim.resolve(file)
    const pathname = resolved
      .split("/")
      .map((part, index) => index === 0 && part === "" ? "" : encodeURIComponent(part))
      .join("/")
    return new URL(`file://${pathname.startsWith("/") ? "" : "/"}${pathname}`)
  }

  const fileURLToPath = (value) => {
    const url = value instanceof URL ? value : new URL(String(value))
    if (url.protocol !== "file:") {
      throw new TypeError("The URL must be of scheme file")
    }
    if (url.hostname && url.hostname !== "localhost") {
      throw new TypeError("File URL host must be empty or localhost")
    }
    return decodeURIComponent(url.pathname)
  }

  const urlShim = {
    URL: globalThis.URL,
    URLSearchParams: globalThis.URLSearchParams,
    pathToFileURL,
    fileURLToPath,
    parse: (value) => {
      const url = new URL(String(value), "file:///")
      return {
        protocol: url.protocol,
        slashes: true,
        auth: url.username || url.password ? `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` : null,
        host: url.host,
        port: url.port,
        hostname: url.hostname,
        hash: url.hash,
        search: url.search,
        query: url.search ? url.search.slice(1) : null,
        pathname: url.pathname,
        path: `${url.pathname}${url.search}`,
        href: url.href,
      }
    },
    format: (value) => value instanceof URL ? value.href : String(value?.href || value || ""),
  }

  const formatValue = (value) => {
    if (typeof value === "string") return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  const utilShim = {
    deprecate: (fn, message) => {
      let warned = false
      return function deprecated(...args) {
        if (!warned) {
          warned = true
          console.warn(message)
        }
        return fn.apply(this, args)
      }
    },
    format: (template, ...args) => {
      if (typeof template !== "string") return [template, ...args].map(formatValue).join(" ")
      let index = 0
      const text = template.replace(/%[sdijoO%]/g, token => {
        if (token === "%%") return "%"
        if (index >= args.length) return token
        const value = args[index++]
        if (token === "%d" || token === "%i") return Number.parseInt(value, 10).toString()
        if (token === "%j" || token === "%o" || token === "%O") return formatValue(value)
        return String(value)
      })
      return [text, ...args.slice(index).map(formatValue)].join(" ")
    },
    inspect: formatValue,
    inherits: (ctor, superCtor) => {
      ctor.super_ = superCtor
      ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
          value: ctor,
          enumerable: false,
          writable: true,
          configurable: true,
        },
      })
    },
    promisify: (fn) => (...args) => new Promise((resolve, reject) => {
      fn(...args, (error, value) => error ? reject(error) : resolve(value))
    }),
    types: {
      isAnyArrayBuffer: value => value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object SharedArrayBuffer]",
    },
  }

  const bytesToBase64 = (bytes) => {
    let binary = ""
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  }

  const base64ToBytes = (base64) => {
    const binary = atob(String(base64))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  const stringToBytes = text => new TextEncoder().encode(String(text))
  const bytesToString = bytes => new TextDecoder("utf-8").decode(bytes)

  const bufferFrom = (value, encoding) => {
    let bytes
    if (typeof value === "string") {
      bytes = encoding === "base64" ? base64ToBytes(value) : stringToBytes(value)
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value)
    } else if (ArrayBuffer.isView(value)) {
      bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    } else if (Array.isArray(value)) {
      bytes = new Uint8Array(value)
    } else {
      bytes = stringToBytes(value ?? "")
    }

    const buffer = new Uint8Array(bytes)
    Object.defineProperty(buffer, "__isBufferShim", { value: true })
    buffer.toString = (targetEncoding = "utf-8") => {
      if (targetEncoding === "base64") return bytesToBase64(buffer)
      return bytesToString(buffer)
    }
    return buffer
  }

  function BufferShim(value, encoding) {
    return bufferFrom(value, encoding)
  }
  BufferShim.from = bufferFrom
  BufferShim.isBuffer = value => !!value?.__isBufferShim
  BufferShim.concat = (items, length) => {
    const buffers = items.map(item => BufferShim.from(item))
    const size = length ?? buffers.reduce((sum, item) => sum + item.length, 0)
    const out = new Uint8Array(size)
    let offset = 0
    for (const item of buffers) {
      out.set(item.subarray(0, Math.max(0, Math.min(item.length, size - offset))), offset)
      offset += item.length
      if (offset >= size) break
    }
    return BufferShim.from(out)
  }
  if (!globalThis.Buffer) globalThis.Buffer = BufferShim

  let helperInfo = null
  let helperReady = false
  let rpcId = 0

  const readConnection = async () => {
    const injected = globalThis.__TP_MACOS_CONNECTION__
    if (injected?.port && injected?.token) {
      helperInfo = injected
      return injected
    }
    const resp = await fetch(connectionUrl.href, { cache: "no-store" })
    if (!resp.ok) throw new Error(`Cannot read helper connection file: ${connectionPath}`)
    const info = await resp.json()
    if (!info?.port || !info?.token) throw new Error("Invalid helper connection file")
    helperInfo = info
    return info
  }

  const rpc = async (method, params = {}) => {
    const info = helperInfo || await readConnection()
    const resp = await fetch(`http://127.0.0.1:${info.port}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${info.token}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    })
    const payload = await resp.json().catch(() => ({}))
    if (!resp.ok || payload.error) {
      const message = payload.error?.message || `HTTP ${resp.status}`
      throw new Error(`RPC ${method} failed: ${message}`)
    }
    return payload.result
  }

  const callbackify = (promise, callback, mapper = value => value) => {
    if (typeof callback !== "function") return promise.then(mapper)
    promise.then(
      value => callback(null, mapper(value)),
      error => callback(error),
    )
    return undefined
  }

  const fsShim = {
    readFile: (file, encoding, callback) => {
      if (typeof encoding === "function") {
        callback = encoding
        encoding = "utf-8"
      }
      return callbackify(rpc("fs.readFile", { path: file, encoding: encoding || "utf-8" }), callback)
    },
    writeFile: (file, content, encoding, callback) => {
      if (typeof encoding === "function") {
        callback = encoding
        encoding = "utf-8"
      }
      return callbackify(rpc("fs.writeFile", { path: file, content, encoding: encoding || "utf-8" }), callback)
    },
    access: (file, mode, callback) => {
      if (typeof mode === "function") callback = mode
      const promise = rpc("fs.access", { path: file }).then(result => {
        if (!result.exists) {
          const error = new Error(`ENOENT: ${file}`)
          error.code = "ENOENT"
          throw error
        }
        return undefined
      })
      return callbackify(promise, callback)
    },
    mkdir: (file, options = {}, callback) => {
      if (typeof options === "function") {
        callback = options
        options = {}
      }
      return callbackify(rpc("fs.mkdir", { path: file, recursive: options.recursive !== false }), callback)
    },
    readdir: (file, options = {}, callback) => {
      if (typeof options === "function") {
        callback = options
        options = {}
      }
      return callbackify(rpc("fs.readdir", { path: file, withFileTypes: !!options.withFileTypes }), callback)
    },
    stat: (file, callback) => callbackify(rpc("fs.stat", { path: file }).then(toStats), callback),
    lstat: (file, callback) => callbackify(rpc("fs.stat", { path: file }).then(toStats), callback),
    rm: (file, options = {}, callback) => callbackify(rpc("fs.remove", { path: file }), typeof options === "function" ? options : callback),
    unlink: (file, callback) => callbackify(rpc("fs.remove", { path: file }), callback),
    rename: (src, dest, callback) => callbackify(rpc("fs.move", { src, dest }), callback),
    copy: (src, dest) => rpc("fs.copy", { src, dest }),
    remove: (file) => rpc("fs.remove", { path: file }),
    ensureDir: (file) => rpc("fs.mkdir", { path: file, recursive: true }),
    pathExists: (file) => rpc("fs.access", { path: file }).then(result => result.exists).catch(() => false),
    readJson: async (file) => JSON.parse(await rpc("fs.readFile", { path: file, encoding: "utf-8" })),
    writeJson: (file, value, options = {}) => rpc("fs.writeFile", {
      path: file,
      content: JSON.stringify(value, null, options.spaces ?? 2),
      encoding: "utf-8",
    }),
    createReadStream: () => { throw new Error("fs.createReadStream is not available in macOS WebKit mode") },
    createWriteStream: () => { throw new Error("fs.createWriteStream is not available in macOS WebKit mode") },
  }
  fsShim.promises = fsShim

  function toStats(stat) {
    return {
      ...stat,
      isFile: () => !!stat.isFile,
      isDirectory: () => !!stat.isDirectory,
      isSymbolicLink: () => !!stat.isSymbolicLink,
      mtime: new Date(stat.mtimeMs || Date.now()),
    }
  }

  const osShim = {
    homedir: () => helperInfo?.home || pluginRoot,
    tmpdir: () => "/tmp",
    platform: () => "darwin",
    arch: () => navigator.platform?.includes("arm") ? "arm64" : "x64",
    type: () => "Darwin",
    release: () => ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, ".") || "",
    EOL: "\n",
  }

  const makeEmitter = () => ({
    _handlers: Object.create(null),
    on(event, handler) {
      ;(this._handlers[event] ||= []).push(handler)
      return this
    },
    once(event, handler) {
      const wrapped = (...args) => {
        this.off(event, wrapped)
        handler(...args)
      }
      return this.on(event, wrapped)
    },
    off(event, handler) {
      this._handlers[event] = (this._handlers[event] || []).filter(item => item !== handler)
      return this
    },
    emit(event, ...args) {
      for (const handler of this._handlers[event] || []) handler(...args)
    },
  })

  const childProcessShim = {
    execFile: (command, args = [], options = {}, callback) => {
      if (typeof args === "function") {
        callback = args
        args = []
        options = {}
      } else if (typeof options === "function") {
        callback = options
        options = {}
      }
      const promise = rpc("process.exec", { command, args, cwd: options.cwd, timeout: options.timeout })
      if (typeof callback !== "function") return promise
      promise.then(
        result => callback(result.code ? Object.assign(new Error(result.stderr || "Command failed"), { code: result.code }) : null, result.stdout, result.stderr),
        error => callback(error),
      )
      return undefined
    },
    exec: (command, options = {}, callback) => {
      if (typeof options === "function") {
        callback = options
        options = {}
      }
      const promise = rpc("process.exec", {
        command: "/bin/sh",
        args: ["-lc", command],
        cwd: options.cwd,
        timeout: options.timeout,
      })
      if (typeof callback !== "function") return promise
      promise.then(
        result => callback(result.code ? Object.assign(new Error(result.stderr || "Command failed"), { code: result.code }) : null, result.stdout, result.stderr),
        error => callback(error),
      )
      return undefined
    },
    spawn: (command, args = [], options = {}) => {
      if (!Array.isArray(args)) {
        options = args || {}
        args = []
      }
      const child = makeEmitter()
      child.stdout = makeEmitter()
      child.stderr = makeEmitter()
      rpc("process.spawnBuffered", { command, args, cwd: options.cwd, shell: !!options.shell, timeout: options.timeout })
        .then(result => {
          if (result.stdout) child.stdout.emit("data", result.stdout)
          if (result.stderr) child.stderr.emit("data", result.stderr)
          child.emit("close", result.code || 0)
          child.emit("exit", result.code || 0)
        })
        .catch(error => child.emit("error", error))
      return child
    },
  }

  const electronShim = {
    shell: {
      openPath: (file) => JSBridge.invoke("shell.openPath", file),
      openExternal: (url) => JSBridge.invoke("shell.openExternal", url),
    },
    ipcRenderer: {
      on: () => {},
      send: () => {},
      invoke: () => Promise.resolve(),
    },
  }

  const shims = {
    buffer: { Buffer: BufferShim },
    path: pathShim,
    fs: fsShim,
    "fs-extra": fsShim,
    os: osShim,
    url: urlShim,
    util: utilShim,
    child_process: childProcessShim,
    electron: electronShim,
  }

  const baseRegistry = new Map()
  const customRegistry = new Map()

  const registerBasePlugins = (registry) => {
    for (const [name, loader] of Object.entries(registry || {})) {
      baseRegistry.set(name, loader)
    }
  }

  const registerCustomPlugins = (registry) => {
    for (const [name, moduleValue] of Object.entries(registry || {})) {
      customRegistry.set(name, moduleValue)
    }
  }

  const requirePlugin = (absolutePath, pathParts = []) => {
    const normalized = normalizePath(absolutePath)
    const parts = Array.from(pathParts)
    const name = String(parts[parts.length - 1] || pathShim.basename(normalized)).replace(/\.js$/, "")
    const registry = normalized.includes("/plugin/custom/plugins/") ? customRegistry : baseRegistry
    const value = registry.get(name)
    if (!value) throw new Error(`macOS plugin module is not registered: ${name}`)
    return typeof value === "function" ? value() : value
  }

  const requireModule = (id) => {
    if (shims[id]) return shims[id]
    if (id === "vscode-ripgrep") return { rgPath: "__TP_MACOS_RG__" }
    if (typeof id === "string" && id.startsWith(pluginRoot)) return requirePlugin(id, [pathShim.basename(id)])
    throw new Error(`Module is not available in macOS WebKit mode: ${id}`)
  }

  const loadCustomPlugins = async () => {
    const plugins = await rpc("customPlugins.list", {})
    const loaded = Object.create(null)
    for (const item of plugins) {
      try {
        const code = await rpc("customPlugins.read", { path: item.path })
        const module = { exports: {} }
        const exports = module.exports
        const localRequire = (id) => {
          if (id.startsWith(".")) {
            throw new Error(`Relative custom plugin require is not supported in macOS v1: ${id}`)
          }
          return requireModule(id)
        }
        const sourceUrl = `//# sourceURL=${item.path}`
        const fn = new Function("module", "exports", "require", "global", "window", "document", `${code}\n${sourceUrl}`)
        fn(module, exports, localRequire, globalThis, window, document)
        loaded[item.fixedName] = module.exports
      } catch (error) {
        console.error(`[typora-plugin] Failed to load custom plugin ${item.fixedName}:`, error)
      }
    }
    registerCustomPlugins(loaded)
    return loaded
  }

  const init = async () => {
    if (helperReady) return true
    if (!isWebKit) {
      console.warn("[typora-plugin] macOS WebKit runtime was loaded outside Typora WebKit")
    }
    const info = await readConnection()
    const health = await rpc("health", {})
    helperReady = !!health?.ok
    if (!helperReady) throw new Error("Typora Plugin helper health check failed")
    helperInfo = { ...info, ...health }
    return true
  }

  globalThis.require = requireModule
  globalThis.reqnode = requireModule
  globalThis.dirname = pluginRoot
  globalThis.__dirname = coreDir
  globalThis.__TP_MACOS__ = {
    version,
    isWebKit,
    pluginRoot,
    init,
    rpc,
    shims,
    requirePlugin,
    requireModule,
    registerBasePlugins,
    registerCustomPlugins,
    loadCustomPlugins,
  }

  window.__TP_MACOS__ = globalThis.__TP_MACOS__
})();
