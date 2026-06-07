const original = require("../../sidebar_enhance.js")
const SidebarEnhancePlugin = original.plugin

class MacosSidebarEnhancePlugin extends SidebarEnhancePlugin {
  _fileCount = () => {
    const getObserver = () => {
      return new MutationObserver(mutations => {
        if (mutations.length === 1) {
          const added = mutations[0].addedNodes[0]
          if (added?.classList?.contains("file-library-node")) {
            countDir(added)
            return
          }
        }
        countAllDirs()
      })
    }
    const getWalkOptions = () => {
      const abortController = new AbortController()
      const allowedExt = new Set(this.config.COUNT_EXT.map(ext => {
        const prefix = (ext !== "" && !ext.startsWith(".")) ? "." : ""
        return prefix + ext.toLowerCase()
      }))
      const verifyExt = name => allowedExt.has(this.utils.Package.Path.extname(name).toLowerCase())
      const verifySize = stat => 0 > this.config.MAX_SIZE || stat.size < this.config.MAX_SIZE
      return {
        fileFilter: (name, filepath, stat) => verifySize(stat) && verifyExt(name),
        dirFilter: name => !this.config.IGNORE_FOLDERS.includes(name),
        fileParamsGetter: this.utils.identity,
        maxEntities: this.config.MAX_ENTITIES,
        semaphore: this.config.CONCURRENCY_LIMIT,
        followSymlinks: this.config.FOLLOW_SYMBOLIC_LINKS,
        signal: abortController.signal,
        onFinished: (err) => {
          if (!err) return
          if (err.name === "AbortError") {
            console.warn("File-Counter Aborted")
          } else if (err.name === "QuotaExceededError") {
            observer.disconnect()
            abortController.abort(new DOMException("Stop File-Counter", "AbortError"))
            document.querySelectorAll(".file-node-content[data-count]").forEach(el => {
              el.removeAttribute("data-count")
              el.querySelector(".plugin-file-count-badge")?.remove()
            })
            this.utils.notification.show(this.i18n.t("error.tooManyFiles"), "warning", 7000)
          }
        },
      }
    }

    const observer = getObserver()
    const walkOptions = getWalkOptions()
    const badgeClass = "plugin-file-count-badge"
    const setDisplayCount = (displayEl, fileCount) => {
      if (!displayEl) return
      let badge = displayEl.querySelector(`:scope > .${badgeClass}`)
      if (fileCount <= this.config.MIN_FILES_TO_DISPLAY) {
        displayEl.removeAttribute("data-count")
        badge?.remove()
        return
      }
      displayEl.setAttribute("data-count", fileCount)
      if (!badge) {
        badge = document.createElement("span")
        badge.className = badgeClass
        displayEl.appendChild(badge)
      }
      badge.textContent = fileCount
    }
    const setCount = async (node) => {
      let fileCount = 0
      await this.utils.walkDir({ ...walkOptions, dir: node.dataset.path, onFile: () => fileCount++ })
      setDisplayCount(node.querySelector(":scope > .file-node-content"), fileCount)
    }
    const countDir = (node) => {
      if (!node) return
      setCount(node)
      node.querySelectorAll(`:scope > .file-node-children > .file-library-node[data-has-sub="true"]`).forEach(countDir)
    }
    const countAllDirs = () => countDir(this.entities.fileTreeRoot)
    this.utils.insertStyle("count-file",
      `#typora-sidebar .file-node-content[data-count] {
          display: flex;
          align-items: center;
          width: auto;
          max-width: none;
          min-width: 0;
          padding-right: 8px;
          box-sizing: border-box;
        }
        #typora-sidebar .file-node-content[data-count] .file-node-open-state,
        #typora-sidebar .file-node-content[data-count] .file-node-icon {
          flex: 0 0 auto;
        }
        #typora-sidebar .file-node-content[data-count] .file-node-title {
          flex: 1 1 auto;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #typora-sidebar .file-node-content[data-count] .plugin-file-count-badge {
          position: sticky;
          right: 8px;
          z-index: 2;
          flex: 0 0 auto;
          min-width: 1.8em;
          padding: 0 3px;
          margin-left: auto;
          border-radius: 3px;
          box-sizing: border-box;
          text-align: center;
          line-height: 1.45;
          color: ${this.config.TEXT_COLOR || "var(--active-file-text-color)"};
          background: ${this.config.BACKGROUND_COLOR || "var(--active-file-bg-color)"};
          font-weight: ${this.config.FONT_WEIGHT};
          pointer-events: none;
        }`,
    )
    this.utils.eventHub.addEventListener(this.utils.eventHub.eventType.allPluginsHadInjected, () => {
      File.editor.library.refreshPanelCommand()
      countAllDirs()
    })
    observer.observe(this.entities.fileTree, { subtree: true, childList: true })
  }
}

module.exports = { ...original, plugin: MacosSidebarEnhancePlugin }
