const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const fsp = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const { describe, it, afterEach } = require("node:test")

const helper = require("../../plugin/macos/helper/server.js")

const root = path.resolve(__dirname, "../..")
const corePath = path.join(root, "plugin/global/core/index.js")
const helperPath = path.join(root, "plugin/macos/helper/server.js")
const bundlePath = path.join(root, "plugin/macos/entry.bundle.js")
const loaderPath = path.join(root, "plugin/macos/loader.js")

async function mktemp() {
  return await fsp.mkdtemp(path.join(os.tmpdir(), "typora-plugin-macos-"))
}

async function waitForFile(file, timeout = 5000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (fs.existsSync(file)) {
      return JSON.parse(await fsp.readFile(file, "utf-8"))
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${file}`)
}

async function rpc(port, token, method, params = {}) {
  return await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
}

describe("macOS path guard", () => {
  it("rejects sibling prefix paths", async () => {
    const guard = helper.createPathGuard(["/Users/cat"])
    await assert.rejects(() => guard("/Users/cat2/secrets.md"), /Path not allowed/)
  })

  it("rejects symlinks that resolve outside an allowed root", async () => {
    const tmp = await mktemp()
    const allowed = path.join(tmp, "allowed")
    const outside = path.join(tmp, "outside")
    await fsp.mkdir(allowed)
    await fsp.mkdir(outside)
    await fsp.writeFile(path.join(outside, "secret.txt"), "secret")
    await fsp.symlink(outside, path.join(allowed, "link"))

    const guard = helper.createPathGuard([allowed])
    await assert.rejects(() => guard(path.join(allowed, "link", "secret.txt")), /Path not allowed/)
  })
})

describe("macOS helper server", () => {
  let child
  let tmp

  afterEach(async () => {
    if (child) {
      child.kill("SIGTERM")
      child = null
    }
    if (tmp) {
      await fsp.rm(tmp, { recursive: true, force: true })
      tmp = null
    }
  })

  it("requires token auth and serves health", async () => {
    tmp = await mktemp()
    const pluginRoot = path.join(tmp, "install")
    const typeMarkRoot = path.join(tmp, "TypeMark")
    const connection = path.join(pluginRoot, "plugin/macos/helper/connection.json")
    await fsp.mkdir(path.dirname(connection), { recursive: true })
    await fsp.mkdir(typeMarkRoot, { recursive: true })

    const token = "a".repeat(64)
    child = spawn(process.execPath, [helperPath], {
      env: {
        ...process.env,
        TYPORA_PLUGIN_ROOT: pluginRoot,
        TYPORA_TYPEMARK_ROOT: typeMarkRoot,
        TYPORA_HELPER_PORT: "0",
        TYPORA_HELPER_TOKEN: token,
        TYPORA_HELPER_CONNECTION_FILE: connection,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    const info = await waitForFile(connection)
    assert.equal(info.token, token)
    assert.ok(info.port > 0)

    const bad = await rpc(info.port, "bad-token", "health")
    assert.equal(bad.status, 401)

    const good = await rpc(info.port, token, "health")
    assert.equal(good.status, 200)
    const payload = await good.json()
    assert.equal(payload.result.ok, true)
    assert.equal(payload.result.pluginRoot, pluginRoot)
  })

  it("rejects out-of-root paths through RPC", async () => {
    tmp = await mktemp()
    const pluginRoot = path.join(tmp, "install")
    const typeMarkRoot = path.join(tmp, "TypeMark")
    const connection = path.join(pluginRoot, "plugin/macos/helper/connection.json")
    await fsp.mkdir(path.dirname(connection), { recursive: true })
    await fsp.mkdir(typeMarkRoot, { recursive: true })

    const token = "b".repeat(64)
    child = spawn(process.execPath, [helperPath], {
      env: {
        ...process.env,
        TYPORA_PLUGIN_ROOT: pluginRoot,
        TYPORA_TYPEMARK_ROOT: typeMarkRoot,
        TYPORA_HELPER_PORT: "0",
        TYPORA_HELPER_TOKEN: token,
        TYPORA_HELPER_CONNECTION_FILE: connection,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })

    const info = await waitForFile(connection)
    const sibling = path.join(path.dirname(os.homedir()), `${path.basename(os.homedir())}-not-allowed`, "x.txt")
    const result = await rpc(info.port, token, "fs.readFile", { path: sibling })
    assert.equal(result.status, 500)
    const payload = await result.json()
    assert.match(payload.error.message, /Path not allowed/)
  })

})

describe("macOS bundle artifacts", () => {
  it("replays existing code fences for standalone files without a mount folder", async () => {
    const core = await fsp.readFile(corePath, "utf-8")
    const replayIndex = core.indexOf("Object.keys(queue).forEach")
    const mountIndex = core.indexOf("File.getMountFolder() != null")

    assert.notEqual(replayIndex, -1)
    assert.notEqual(mountIndex, -1)
    assert.ok(replayIndex < mountIndex)
  })

  it("has a loader and bundle entry without global module.exports startup", async () => {
    const loader = await fsp.readFile(loaderPath, "utf-8")
    assert.match(loader, /entry\.bundle\.js/)

    const bundle = await fsp.readFile(bundlePath, "utf-8")
    assert.match(bundle, /macOS bundle entry failed/)
    assert.match(bundle, /createMacosLinterClient/)
    assert.doesNotMatch(bundle, /await module\.exports\(\)/)
    assert.match(bundle, /deflateRawSync/)
    assert.doesNotMatch(bundle, /Module is not available in macOS WebKit mode: buffer/)
    assert.doesNotMatch(bundle, /Module is not available in macOS WebKit mode: zlib/)
    assert.doesNotMatch(bundle, /macos-unsupported:url/)
    assert.doesNotMatch(bundle, /macos-unsupported:util/)
  })
})
