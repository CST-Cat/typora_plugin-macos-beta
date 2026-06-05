const coreEntry = require("../global/core")
const basePluginRegistry = require("macos-plugin-registry")

function removeLegacyDiagnosticMarker() {
  document.getElementById("typora-plugin-macos-diagnostic")?.remove()
}

function report(text, kind = "info") {
  removeLegacyDiagnosticMarker()
  console.log(`[typora-plugin] ${text}`)
  window.__TP_MACOS__?.rpc?.("diagnostic.log", {
    source: "bundle-entry",
    level: kind,
    message: text,
  }).catch(() => {})
}

async function waitForWindowLoad() {
  if (document.readyState === "complete") return
  await new Promise(resolve => window.addEventListener("load", resolve, { once: true }))
}

async function main() {
  window.__TP_MACOS_BUNDLE_ENTRY_STARTED__ = true
  report("Typora Plugin bundle entry started")
  await waitForWindowLoad()

  const runtime = window.__TP_MACOS__
  if (!runtime) throw new Error("macOS runtime shims are not loaded")

  report("Typora Plugin initializing helper/runtime")
  await runtime.init()
  report("Typora Plugin loading registries")
  runtime.registerBasePlugins(basePluginRegistry)
  await runtime.loadCustomPlugins()
  report("Typora Plugin starting core")
  await coreEntry()
  window.__TP_MACOS_CORE_LOADED__ = true
  report("Typora Plugin loaded. Right-click editor area to open plugin menu.", "ok")
}

main().catch(error => {
  console.error("[typora-plugin] macOS bundle entry failed:", error)
  report(`Typora Plugin core failed:\n${error?.message || error}\n${error?.stack || ""}`, "error")
})
