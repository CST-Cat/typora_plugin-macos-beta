;(() => {
  "use strict"

  const logToHelper = (text, kind = "info") => {
    const connection = globalThis.__TP_MACOS_CONNECTION__
    if (connection?.port && connection?.token) {
      fetch(`http://127.0.0.1:${connection.port}/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${connection.token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now(),
          method: "diagnostic.log",
          params: { source: "loader", level: kind, message: text },
        }),
      }).catch(() => {})
    }
  }

  const removeLegacyDiagnosticMarker = () => {
    document.getElementById("typora-plugin-macos-diagnostic")?.remove()
  }

  const report = (text, kind = "info") => {
    removeLegacyDiagnosticMarker()
    console.log(`[typora-plugin] ${text}`)
    logToHelper(text, kind)
  }

  removeLegacyDiagnosticMarker()

  const currentScript = document.currentScript
  const baseUrl = new URL(".", currentScript?.src || location.href)
  const connectionUrl = new URL("helper/connection.js", baseUrl)
  const bundleUrl = new URL("entry.bundle.js", baseUrl)
  const cacheKey = `v=${Date.now()}`
  connectionUrl.search = cacheKey
  bundleUrl.search = cacheKey
  const loadedScripts = new Set(Array.from(document.scripts).map(script => script.src).filter(Boolean))
  report("Typora Plugin macOS loader started")

  const installErrorHooks = () => {
    if (globalThis.__TP_MACOS_ERROR_HOOKS__) return
    globalThis.__TP_MACOS_ERROR_HOOKS__ = true
    const stringify = value => {
      if (value instanceof Error) return `${value.message}\n${value.stack || ""}`
      if (typeof value === "string") return value
      try {
        return JSON.stringify(value)
      } catch (_) {
        return String(value)
      }
    }
    const logOrReportRuntimeError = message => {
      if (globalThis.__TP_MACOS_CORE_LOADED__) {
        logToHelper(message, "warn")
      } else {
        report(message, "error")
      }
    }
    const isNonFatalMacosError = text => (
      /RPC fs\.readdir failed: (EPERM|EACCES)/.test(text)
      || /Error processing path .+:\s+RPC fs\.readdir failed: (EPERM|EACCES)/.test(text)
    )
    const originalConsoleError = console.error.bind(console)
    console.error = (...args) => {
      const text = args.map(stringify).join("\n")
      if (!text.trim()) {
        console.warn(...args)
        logToHelper("[empty console.error suppressed]", "warn")
        return
      }
      if (isNonFatalMacosError(text)) {
        console.warn(...args)
        logToHelper(text, "warn")
        return
      }
      originalConsoleError(...args)
      logToHelper(text, "error")
    }
    window.addEventListener("error", event => {
      logOrReportRuntimeError(`Typora Plugin window error:\n${event.message}\n${event.filename || ""}:${event.lineno || ""}:${event.colno || ""}`)
    })
    window.addEventListener("unhandledrejection", event => {
      const reason = event.reason
      const message = `Typora Plugin unhandled rejection:\n${reason?.message || reason}\n${reason?.stack || ""}`
      logOrReportRuntimeError(message)
      if (globalThis.__TP_MACOS_CORE_LOADED__) event.preventDefault()
    })
  }

  const loadScript = (src) => new Promise((resolve, reject) => {
    if (loadedScripts.has(src)) {
      resolve()
      return
    }
    const script = document.createElement("script")
    script.src = src
    script.defer = true
    script.onload = () => {
      loadedScripts.add(src)
      resolve()
    }
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
  })

  loadScript(connectionUrl.href)
    .catch(error => {
      console.warn("[typora-plugin] Failed to load macOS helper connection script:", error)
      report(`Typora Plugin connection script failed:\n${error.message}`, "error")
    })
    .then(() => {
      installErrorHooks()
      report("Typora Plugin helper connection loaded")
    })
    .then(() => loadScript(bundleUrl.href))
    .then(() => {
      report("Typora Plugin macOS bundle loaded", "ok")
      const reportBundleStatus = deadline => {
        const ready = !!globalThis.__TP_MACOS_CORE_LOADED__
        if (!ready && Date.now() < deadline) {
          setTimeout(() => reportBundleStatus(deadline), 500)
          return
        }
        report([
          "Typora Plugin bundle status",
          `runtime=${!!globalThis.__TP_MACOS__}`,
          `entryStarted=${!!globalThis.__TP_MACOS_BUNDLE_ENTRY_STARTED__}`,
          `coreLoaded=${ready}`,
        ].join("\n"), ready ? "ok" : "error")
      }
      setTimeout(() => reportBundleStatus(Date.now() + 8000), 1000)
    })
    .catch(error => {
      console.error("[typora-plugin] Failed to load macOS bundle:", error)
      report(`Typora Plugin bundle failed:\n${error.message}`, "error")
    })
})()
