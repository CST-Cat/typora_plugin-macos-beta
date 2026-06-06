#!/usr/bin/env node
"use strict"

const http = require("node:http")
const { execFile } = require("node:child_process")
const crypto = require("node:crypto")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")

const BIND = "127.0.0.1"
const DEFAULT_TIMEOUT = 30000
const MAX_BODY = 5 * 1024 * 1024
const RG_SENTINEL = "__TP_MACOS_RG__"

function isInside(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

async function realpathNearest(target) {
  let current = path.resolve(target)
  while (true) {
    try {
      return await fsp.realpath(current)
    } catch (error) {
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}

function createPathGuard(allowedRoots) {
  const roots = allowedRoots
    .filter(Boolean)
    .map(root => path.resolve(root))

  return async function safePath(input) {
    if (!input || typeof input !== "string") {
      throw new Error("Path must be a non-empty string")
    }
    const resolved = path.resolve(input)
    const resolvedAllowed = roots.some(root => isInside(resolved, root))
    if (!resolvedAllowed) throw new Error(`Path not allowed: ${input}`)

    const real = await realpathNearest(resolved).catch(() => resolved)
    const realAllowed = roots.some(root => isInside(real, root))
    if (!realAllowed) throw new Error(`Path not allowed: ${input}`)

    return resolved
  }
}

function findRgBinary(typeMarkRoot) {
  const candidates = [
    path.join(typeMarkRoot, "lib/bin/arm/rg"),
    path.join(typeMarkRoot, "lib/bin/x64/rg"),
    "/opt/homebrew/bin/rg",
    "/usr/local/bin/rg",
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || "rg"
}

function execBuffered(command, args = [], options = {}) {
  return new Promise(resolve => {
    execFile(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env || {}) },
      maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
      timeout: options.timeout || DEFAULT_TIMEOUT,
    }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code || 0,
        signal: error?.signal || null,
        error: error?.message || null,
        stdout: stdout || "",
        stderr: stderr || "",
      })
    })
  })
}

const isMarkdownPath = file => /\.(md|markdown|mdown|mkd)$/i.test(file || "")

async function collectRecentPathEntries(paths, safePath) {
  const files = []
  const folders = []
  const seen = new Set()
  for (const item of paths) {
    if (!item || seen.has(item)) continue
    seen.add(item)
    try {
      const file = await safePath(item)
      const stat = await fsp.stat(file)
      if (stat.isDirectory()) {
        folders.push({ path: file })
      } else if (stat.isFile() && isMarkdownPath(file)) {
        files.push({ path: file })
      }
    } catch {}
  }
  return { files, folders }
}

async function readTyporaRecentFolders(safePath) {
  const prefsPath = path.join(os.homedir(), "Library/Preferences/abnerworks.Typora.plist")
  const result = await execBuffered("/usr/bin/plutil", ["-extract", "recentFolder", "json", "-o", "-", prefsPath], { timeout: 3000 })
  if (!result.ok || !result.stdout.trim()) return []

  let folders
  try {
    folders = JSON.parse(result.stdout)
  } catch {
    return []
  }

  const validFolders = []
  for (const item of folders) {
    try {
      const folder = await safePath(item)
      const stat = await fsp.stat(folder)
      if (stat.isDirectory()) validFolders.push(folder)
    } catch {}
  }
  return validFolders
}

async function readSpotlightRecentMarkdownFiles(safePath) {
  const query = 'kMDItemLastUsedDate == * && (kMDItemFSName == "*.md" || kMDItemFSName == "*.markdown" || kMDItemFSName == "*.mdown" || kMDItemFSName == "*.mkd")'
  const result = await execBuffered("/usr/bin/mdfind", [query], { timeout: 3000 })
  if (!result.ok) return { files: [], folders: [] }
  const recentFolders = await readTyporaRecentFolders(safePath)
  const paths = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .filter(file => recentFolders.length === 0 || recentFolders.some(folder => isInside(path.resolve(file), folder)))
    .slice(0, 120)
  return await collectRecentPathEntries(paths, safePath)
}

async function readMacosTyporaRecentFiles(safePath) {
  const sflPath = path.join(
    os.homedir(),
    "Library/Application Support/com.apple.sharedfilelist/com.apple.LSSharedFileList.ApplicationRecentDocuments/abnerworks.typora.sfl4",
  )
  const xmlResult = await execBuffered("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", sflPath], { timeout: 3000 })
  const xml = (xmlResult.stdout || xmlResult.stderr || "").trim()
  if (!xmlResult.ok || !xml) return await readSpotlightRecentMarkdownFiles(safePath)

  const bookmarks = Array.from(xml.matchAll(/<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/g))
    .map(match => match[1].replace(/\s+/g, ""))
    .filter(data => data.startsWith("Ym9v"))

  if (bookmarks.length === 0) return await readSpotlightRecentMarkdownFiles(safePath)

  const script = `
ObjC.import('Foundation')
const bookmarks = ${JSON.stringify(bookmarks)}
const result = []
for (const bookmark of bookmarks) {
  try {
      const data = $.NSData.alloc.initWithBase64EncodedStringOptions(bookmark, 0)
      if (!data) continue
      const stale = Ref()
      const error = Ref()
      const url = $.NSURL.URLByResolvingBookmarkDataOptionsRelativeToURLBookmarkDataIsStaleError(data, $.NSURLBookmarkResolutionWithoutUI, undefined, stale, error)
      if (url && url.path) result.push(ObjC.unwrap(url.path))
  } catch (error) {
  }
}
console.log(JSON.stringify(result))
`
  const { ok, stdout, stderr } = await execBuffered("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 3000 })
  const output = (stdout || stderr || "").trim()
  if (!ok || !output) return { files: [], folders: [] }

  let paths
  try {
    paths = JSON.parse(output)
  } catch {
    return await readSpotlightRecentMarkdownFiles(safePath)
  }

  const recent = await collectRecentPathEntries(paths, safePath)
  return recent.files.length || recent.folders.length ? recent : await readSpotlightRecentMarkdownFiles(safePath)
}

function makeHandlers({ pluginRoot, typeMarkRoot, safePath, rgBinary }) {
  const customRoot = path.join(pluginRoot, "plugin/custom/plugins")

  const safeCustomPath = async (input) => {
    const resolved = await safePath(input)
    if (!isInside(resolved, customRoot)) throw new Error(`Custom plugin path not allowed: ${input}`)
    return resolved
  }

  return {
    health: async () => ({
      ok: true,
      version: "1.0.0",
      pid: process.pid,
      home: os.homedir(),
      pluginRoot,
      typeMarkRoot,
    }),

    "diagnostic.log": async ({ source = "browser", level = "info", message = "" }) => {
      const safeSource = String(source).slice(0, 80)
      const safeLevel = String(level).slice(0, 20)
      const safeMessage = String(message).slice(0, 4000)
      console.log(`[browser:${safeLevel}:${safeSource}] ${safeMessage}`)
      return { ok: true }
    },

    "typora.recentFiles": async () => {
      return await readMacosTyporaRecentFiles(safePath)
    },

    "fs.readFile": async ({ path: file, encoding = "utf-8" }) => {
      return await fsp.readFile(await safePath(file), encoding)
    },

    "fs.writeFile": async ({ path: file, content, encoding = "utf-8" }) => {
      const resolved = await safePath(file)
      await fsp.mkdir(path.dirname(resolved), { recursive: true })
      await fsp.writeFile(resolved, content, encoding)
      return { ok: true }
    },

    "fs.access": async ({ path: file }) => {
      const resolved = await safePath(file)
      try {
        await fsp.access(resolved, fs.constants.R_OK)
        return { exists: true, readable: true }
      } catch {
        return { exists: false, readable: false }
      }
    },

    "fs.mkdir": async ({ path: file, recursive = true }) => {
      await fsp.mkdir(await safePath(file), { recursive })
      return { ok: true }
    },

    "fs.remove": async ({ path: file }) => {
      await fsp.rm(await safePath(file), { recursive: true, force: true })
      return { ok: true }
    },

    "fs.copy": async ({ src, dest }) => {
      await fsp.cp(await safePath(src), await safePath(dest), { recursive: true })
      return { ok: true }
    },

    "fs.move": async ({ src, dest }) => {
      await fsp.rename(await safePath(src), await safePath(dest))
      return { ok: true }
    },

    "fs.readdir": async ({ path: file, withFileTypes = false }) => {
      const entries = await fsp.readdir(await safePath(file), { withFileTypes })
      if (!withFileTypes) return entries
      return entries.map(entry => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
      }))
    },

    "fs.stat": async ({ path: file }) => {
      const stat = await fsp.lstat(await safePath(file))
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        isSymbolicLink: stat.isSymbolicLink(),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      }
    },

    "process.exec": async ({ command, args = [], cwd, timeout = DEFAULT_TIMEOUT }) => {
      const actual = command === RG_SENTINEL ? rgBinary : command
      const safeCwd = cwd ? await safePath(cwd) : undefined
      return await execBuffered(actual, args, { cwd: safeCwd, timeout })
    },

    "process.spawnBuffered": async ({ command, args = [], cwd, shell = false, timeout = DEFAULT_TIMEOUT }) => {
      const safeCwd = cwd ? await safePath(cwd) : undefined
      if (command === RG_SENTINEL) {
        return await execBuffered(rgBinary, args, { cwd: safeCwd, timeout })
      }
      if (shell) {
        return await execBuffered("/bin/sh", ["-lc", command], { cwd: safeCwd, timeout })
      }
      return await execBuffered(command, args, { cwd: safeCwd, timeout })
    },

    "rg.search": async ({ pattern, path: searchPath, args = [] }) => {
      const root = searchPath ? await safePath(searchPath) : os.homedir()
      const result = await execBuffered(rgBinary, ["--json", ...args, pattern, root], { timeout: DEFAULT_TIMEOUT })
      if (!result.ok && result.code !== 1) return { ok: false, error: result.error, matches: [] }
      const matches = []
      for (const line of result.stdout.split("\n")) {
        if (!line.trim()) continue
        try {
          const item = JSON.parse(line)
          if (item.type !== "match") continue
          matches.push({
            path: item.data.path.text,
            line: item.data.line_number,
            text: item.data.lines.text,
            submatches: item.data.submatches.map(match => ({
              start: match.start,
              end: match.end,
              text: match.text,
            })),
          })
        } catch {}
      }
      return { ok: true, matches, truncated: false }
    },

    "customPlugins.list": async () => {
      try {
        const entries = await fsp.readdir(await safePath(customRoot), { withFileTypes: true })
        const plugins = []
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue
          if (entry.isFile() && entry.name.endsWith(".js")) {
            plugins.push({
              fixedName: entry.name.replace(/\.js$/, ""),
              path: path.join(customRoot, entry.name),
            })
          } else if (entry.isDirectory()) {
            const index = path.join(customRoot, entry.name, "index.js")
            if (fs.existsSync(index)) {
              plugins.push({ fixedName: entry.name, path: index })
            }
          }
        }
        return plugins
      } catch {
        return []
      }
    },

    "customPlugins.read": async ({ path: file }) => {
      return await fsp.readFile(await safeCustomPath(file), "utf-8")
    },
  }
}

function authorized(headers, token) {
  const value = String(headers.authorization || "").replace(/^Bearer\s+/i, "")
  const expected = Buffer.from(token)
  const actual = Buffer.from(value)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}

function createRpcServer({ token, handlers }) {
  return http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method !== "POST" || req.url !== "/rpc") {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Not found" }))
      return
    }

    if (!authorized(req.headers, token)) {
      res.writeHead(401, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }))
      return
    }

    let body = ""
    for await (const chunk of req) {
      body += chunk
      if (body.length > MAX_BODY) {
        res.writeHead(413, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32002, message: "Payload too large" } }))
        return
      }
    }

    let request
    try {
      request = JSON.parse(body)
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }))
      return
    }

    const { method, params = {}, id = null } = request
    const handler = handlers[method]
    if (!handler) {
      res.writeHead(404, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }))
      return
    }

    try {
      const result = await handler(params)
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id, result }))
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message: error.message } }))
    }
  })
}

async function writeConnectionFile(file, info) {
  if (!file) return
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify(info, null, 2), { mode: 0o600 })
  await fsp.chmod(file, 0o600).catch(() => {})
}

async function startFromEnv() {
  const token = process.env.TYPORA_HELPER_TOKEN
  if (!token) throw new Error("TYPORA_HELPER_TOKEN is required")

  const pluginRoot = path.resolve(process.env.TYPORA_PLUGIN_ROOT || process.cwd())
  const typeMarkRoot = path.resolve(process.env.TYPORA_TYPEMARK_ROOT || "/Applications/Typora.app/Contents/Resources/TypeMark")
  const port = Number.parseInt(process.env.TYPORA_HELPER_PORT || "0", 10)
  const connectionFile = process.env.TYPORA_HELPER_CONNECTION_FILE || path.join(pluginRoot, "plugin/macos/helper/connection.json")
  const safePath = createPathGuard([os.homedir(), pluginRoot, typeMarkRoot, os.tmpdir(), "/tmp"])
  const rgBinary = findRgBinary(typeMarkRoot)
  const handlers = makeHandlers({ pluginRoot, typeMarkRoot, safePath, rgBinary })
  const server = createRpcServer({ token, handlers })

  await new Promise(resolve => server.listen(port, BIND, resolve))
  const address = server.address()
  const info = {
    port: address.port,
    token,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  }
  await writeConnectionFile(connectionFile, info)
  console.log(`Typora Plugin helper listening on ${BIND}:${address.port}`)

  const shutdown = () => server.close(() => process.exit(0))
  process.on("SIGTERM", shutdown)
  process.on("SIGINT", shutdown)
}

if (require.main === module) {
  startFromEnv().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  createPathGuard,
  createRpcServer,
  findRgBinary,
  isInside,
  makeHandlers,
  readMacosTyporaRecentFiles,
  realpathNearest,
}
