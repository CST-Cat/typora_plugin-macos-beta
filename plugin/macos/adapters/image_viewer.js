const original = require("../../image_viewer.js")
const ImageViewerPlugin = original.plugin

const patchGallery = (gallery) => {
  if (!gallery || gallery.__typoraPluginMacosPatched) return
  gallery.__typoraPluginMacosPatched = true
  gallery.imageInfos = []

  gallery._isMacosWebKit = () => typeof window !== "undefined" && !!window.__TP_MACOS__

  gallery._splitLocalSrc = src => {
    const queryIdx = src.indexOf("?")
    const hashIdx = src.indexOf("#")
    const idx = [queryIdx, hashIdx].filter(idx => idx >= 0).sort((a, b) => a - b)[0]
    return idx == null ? [src, ""] : [src.slice(0, idx), src.slice(idx)]
  }

  gallery._toFileUrl = file => `file://${String(file).split("/").map(encodeURIComponent).join("/")}`

  gallery._getLocalImageBase = () => {
    const path = gallery.utils.Package.Path
    const filepath = gallery.utils.getFilePath()
    const mountFolder = gallery.utils.getMountFolder()

    if (filepath) {
      const currentDir = path.dirname(filepath)
      if (path.isAbsolute(filepath)) return currentDir
      if (mountFolder) return path.resolve(mountFolder, currentDir === "." ? "" : currentDir)
      if (currentDir && currentDir !== ".") return currentDir
    }

    return mountFolder || ""
  }

  gallery._resolveSrc = src => {
    if (!src || !gallery._isMacosWebKit()) return src
    if (/^(?:https?|ftp|data|blob|chrome-blob|moz-blob|file|typora):/i.test(src)) return src
    if (/^[a-z][a-z\d+.-]*:/i.test(src)) return src

    const [pathname, suffix] = gallery._splitLocalSrc(src)
    const base = gallery._getLocalImageBase()
    if (!base || !pathname) return src

    let decoded = pathname
    try {
      decoded = decodeURI(pathname)
    } catch {}
    return gallery._toFileUrl(gallery.utils.Package.Path.resolve(base, decoded)) + suffix
  }

  gallery._getImageSrc = img => {
    const container = img?.closest?.(".md-image")
    const attrNames = ["data-src", "data-original", "data-origin-src", "data-image-src", "origin-src", "src"]
    const candidates = [
      ...attrNames.map(attr => img?.getAttribute?.(attr)),
      img?.currentSrc,
      img?.src,
      ...attrNames.map(attr => container?.getAttribute?.(attr)),
    ]
    const src = candidates.find(Boolean) || ""
    return gallery._resolveSrc(src)
  }

  gallery._canonicalSrc = src => {
    src = String(src || "")
    try {
      src = window.removeLastModifyQuery ? window.removeLastModifyQuery(src) : src
    } catch {}
    return src
  }

  gallery._imageToInfo = (img, idx) => ({
    img,
    idx,
    src: gallery._getImageSrc(img),
    alt: img?.getAttribute("alt") ?? "",
    naturalWidth: img?.naturalWidth ?? 0,
    naturalHeight: img?.naturalHeight ?? 0,
  })

  gallery._getMarkdownContent = async () => {
    try {
      const content = gallery.utils.getCurrentFileContent?.()
      if (typeof content === "string") return content
    } catch {}

    try {
      const content = File?.editor?.getMarkdown?.()
      if (typeof content === "string") return content
    } catch {}

    try {
      const content = await File?.getContent?.()
      if (typeof content === "string") return content
    } catch {}

    const filepath = gallery.utils.getFilePath()
    if (!filepath || !gallery.utils.Package.Path.isAbsolute(filepath)) return ""
    try {
      return await gallery.utils.Package.FsExtra.readFile(filepath, "utf-8")
    } catch {
      return ""
    }
  }

  gallery._normalizeMarkdownTarget = target => {
    target = String(target || "").trim()
    if (target.startsWith("<") && target.endsWith(">")) {
      return target.slice(1, -1).trim()
    }
    const titled = target.match(/^(.+?)(?:\s+["'][^"']*["'])$/)
    return (titled ? titled[1] : target).trim()
  }

  gallery._parseMarkdownImageRefs = content => {
    const refs = []
    const inlineImage = /(?<!\\)!\[([^\]\n]*(?:\\\][^\]\n]*)*)\]\(([^)\n]+)\)/g
    for (const match of content.matchAll(inlineImage)) {
      const src = gallery._normalizeMarkdownTarget(match[2])
      if (src) refs.push({ alt: match[1].replace(/\\]/g, "]"), src })
    }

    const htmlImage = /<img\b[^>]*>/gi
    const attr = name => new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i")
    for (const match of content.matchAll(htmlImage)) {
      const tag = match[0]
      const src = tag.match(attr("src"))?.[2]
      if (src) refs.push({ alt: tag.match(attr("alt"))?.[2] || "", src })
    }
    return refs
  }

  gallery._collectImageInfos = async () => {
    const renderedInfos = [...gallery.utils.entities.querySelectorAllInWrite("img")]
      .map(gallery._imageToInfo)
      .filter(info => info.src)
    const renderedBySrc = new Map(renderedInfos.map(info => [gallery._canonicalSrc(info.src), info]))

    const content = await gallery._getMarkdownContent()
    const refs = gallery._parseMarkdownImageRefs(content)
    const markdownInfos = refs
      .map((ref, idx) => {
        const src = gallery._resolveSrc(ref.src)
        const rendered = renderedBySrc.get(gallery._canonicalSrc(src))
        return {
          img: rendered?.img || null,
          idx,
          src,
          alt: ref.alt || rendered?.alt || "",
          naturalWidth: rendered?.naturalWidth || 0,
          naturalHeight: rendered?.naturalHeight || 0,
        }
      })
      .filter(info => info.src)

    return markdownInfos.length ? markdownInfos : renderedInfos
  }

  gallery.getAllImages = () => gallery.imageInfos.map(info => info.img)

  gallery.reset = () => {
    gallery.imageGetter = null
    gallery.imageInfos = []
  }

  gallery.initImageMsgGetter = async () => {
    if (gallery.imageGetter) return

    gallery.imageInfos = await gallery._collectImageInfos()
    gallery.imageGetter = gallery._createImageMsgGetter(gallery.imageInfos)
    if (gallery.imageInfos.length === 0) return

    const target = gallery._getTargetImage(gallery.imageInfos)
    if (!target) return

    while (true) {
      const current = gallery.imageGetter(true)
      if (!current) return
      if (current.img === target.img || gallery._canonicalSrc(current.src) === gallery._canonicalSrc(target.src)) return gallery.imageGetter(false)
      if (current.showIdx === current.total) return
    }
  }

  gallery._createImageMsgGetter = imageInfos => {
    let idx = -1
    const maxIdx = imageInfos.length - 1
    return (next = true) => {
      idx += next ? 1 : -1
      if (idx > maxIdx) idx = 0
      else if (idx < 0) idx = maxIdx

      const info = imageInfos[idx] || {}
      return {
        ...info,
        showIdx: imageInfos.length === 0 ? 0 : idx + 1,
        total: imageInfos.length,
        all: imageInfos,
      }
    }
  }

  gallery._getTargetImage = imageInfos => {
    const strategies = {
      firstImage: infos => infos[0],
      inViewBoxImage: infos => infos.find(info => info.img && gallery.utils.isInViewBox(info.img)),
      closestViewBoxImage: infos => infos
        .filter(info => info.img)
        .reduce((closest, img) => {
          const distance = Math.abs(img.img.getBoundingClientRect().top - window.innerHeight / 2)
          return distance < closest.minDist ? { info: img, minDist: distance } : closest
        }, { info: null, minDist: Number.MAX_VALUE })
        .info,
    }

    const strategyNames = [...gallery.config.FIRST_IMAGE_STRATEGIES, "firstImage"]
    for (const name of strategyNames) {
      const image = strategies[name]?.(imageInfos)
      if (image) return image
    }
  }

  gallery.dumpImage = (direction = "next", condition = () => true) => {
    const isNext = direction === "next"
    if (!gallery.imageGetter) return

    const limit = Math.max(gallery.imageInfos.length, 1)
    for (let i = 0; i <= limit; i++) {
      const curImg = gallery.imageGetter(isNext)
      if (condition(curImg)) return curImg
    }
  }

  gallery.dumpIndex = targetIdx => {
    const safeIdx = Math.max(targetIdx, 0)
    return gallery.dumpImage("next", img => img.total === 0 || img.idx === Math.min(safeIdx, img.total - 1))
  }
}

class MacosImageViewerPlugin extends ImageViewerPlugin {
  eventBlocker = null
  viewerEventSink = null
  blockedChromeStyles = null
  isOpening = false
  modalEventTypes = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu", "touchstart", "touchend"]

  style = () => ({
    imageMaxWidth: this.config.IMAGE_MAX_WIDTH + "%",
    imageMaxHeight: this.config.IMAGE_MAX_HEIGHT + "%",
    toolTop: this.config.TOOL_POSITION === "top" ? "var(--viewer-macos-titlebar-bottom, 0px)" : "initial",
    toolBottom: this.config.TOOL_POSITION === "top" ? "initial" : 0,
    thumbnailTop: this.config.TOOL_POSITION === "top" ? "initial" : "var(--viewer-macos-titlebar-bottom, 0px)",
    thumbnailBottom: this.config.TOOL_POSITION === "top" ? 0 : "initial",
    blurLevel: this.config.BLUR_LEVEL + "px",
  })

  call = () => {
    if (this.utils.isHidden(this.entities.viewer)) {
      this.show().catch(error => console.error("[ImageViewer] Failed to open", error))
    } else {
      this.close()
    }
  }

  process = () => {
    patchGallery(this.gallery)
    this._handleImageInteraction()
    this._installViewerEventSink()

    this.utils.eventHub.addEventListener(this.utils.eventHub.eventType.toggleSettingPage, hide => hide && this.close())

    if (this.config.CLICK_MASK_TO_EXIT) {
      this.entities.mask.addEventListener("click", this.call)
    }
    this.entities.viewer.addEventListener("click", ev => {
      const item = ev.target.closest(".viewer-item")
      if (item) {
        const act = item.getAttribute("action")
        this.dispatcher.execute(act)
      }
    })
    this.entities.viewer.addEventListener("wheel", ev => {
      if (this.utils.isShown(this.entities.waterfall)) return
      ev.preventDefault()
      const fnList = this.getFnList(ev, "WHEEL")
      const fn = fnList[ev.deltaY > 0 ? 1 : 0]
      if (typeof fn === "function") fn()
    }, { passive: false })
    this.entities.ops.addEventListener("click", ev => {
      const target = ev.target.closest("[option]")
      if (!target) return
      const option = target.getAttribute("option")
      const arg = option.includes("rotate") ? 90 : undefined
      this.dispatcher.execute(option, arg)
    })
    this.entities.nav.addEventListener("click", ev => {
      const target = ev.target.closest(".viewer-thumbnail")
      if (target) {
        this.dispatcher.execute("jumpToIndex", parseInt(target.dataset.idx, 10))
      }
    })
    this.entities.waterfall.addEventListener("click", ev => {
      const target = ev.target.closest(".viewer-waterfall-item")
      this.dispatcher.execute("waterfall")
      if (target) {
        this.dispatcher.execute("jumpToIndex", parseInt(target.dataset.idx, 10))
      }
    })
    this.entities.nav.addEventListener("wheel", ev => {
      const target = ev.target.closest(".viewer-nav")
      if (target) target.scrollLeft += ev.deltaY * 0.5
      ev.stopPropagation()
    }, { passive: true })
  }

  _installViewerEventSink = () => {
    this.viewerEventSink = ev => {
      ev.stopPropagation()
    }
    this.modalEventTypes.forEach(type => {
      this.entities.viewer.addEventListener(type, this.viewerEventSink)
    })
  }

  _startEventBlocker = () => {
    if (this.eventBlocker) return
    this.eventBlocker = ev => {
      if (this.utils.isHidden(this.entities.viewer)) return
      if (this.entities.viewer.contains(ev.target)) return
      ev.preventDefault()
      ev.stopImmediatePropagation()
    }
    this.modalEventTypes.forEach(type => {
      window.addEventListener(type, this.eventBlocker, true)
      document.addEventListener(type, this.eventBlocker, true)
    })
  }

  _stopEventBlocker = () => {
    if (!this.eventBlocker) return
    this.modalEventTypes.forEach(type => {
      window.removeEventListener(type, this.eventBlocker, true)
      document.removeEventListener(type, this.eventBlocker, true)
    })
    this.eventBlocker = null
  }

  _getMacosTitlebarBottom = () => {
    const titleText = document.getElementById("title-text")
    const candidates = [
      document.getElementById("top-titlebar"),
      document.querySelector("header"),
      titleText?.closest("#top-titlebar"),
      titleText?.parentElement,
    ].filter(Boolean)
    const bottoms = candidates
      .map(el => {
        const style = window.getComputedStyle(el)
        if (style.display === "none" || style.visibility === "hidden") return 0
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0 ? rect.top + rect.height : 0
      })
      .filter(bottom => bottom > 0 && bottom < 120)
    return Math.ceil(Math.max(40, ...bottoms))
  }

  _setModalActive = active => {
    document.body.classList.toggle("plugin-image-viewer-active", active)
    document.documentElement.classList.toggle("plugin-image-viewer-active", active)
    if (!active) {
      this.entities.viewer.style.removeProperty("--viewer-macos-titlebar-bottom")
      return
    }
    const safeTop = this._getMacosTitlebarBottom()
    this.entities.viewer.style.setProperty("--viewer-macos-titlebar-bottom", `${safeTop}px`)
  }

  _blockTyporaChrome = () => {
    this._restoreTyporaChrome()
    const selectors = [
      "#top-titlebar",
      "#title-text",
      "header",
      "footer",
      "#footer-word-count-label",
      ".ty-footer",
    ]
    const elements = [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
    this.blockedChromeStyles = elements.map(el => ({
      el,
      pointerEvents: el.style.pointerEvents,
      userSelect: el.style.userSelect,
      webkitUserSelect: el.style.webkitUserSelect,
    }))
    elements.forEach(el => {
      el.style.pointerEvents = "none"
      el.style.userSelect = "none"
      el.style.webkitUserSelect = "none"
    })
  }

  _restoreTyporaChrome = () => {
    if (!this.blockedChromeStyles) return
    this.blockedChromeStyles.forEach(({ el, pointerEvents, userSelect, webkitUserSelect }) => {
      el.style.pointerEvents = pointerEvents
      el.style.userSelect = userSelect
      el.style.webkitUserSelect = webkitUserSelect
    })
    this.blockedChromeStyles = null
  }

  _updateMessageBar = ({ src, alt, naturalWidth, naturalHeight, showIdx, idx, total }) => {
    const { msg } = this.entities
    const indexEl = msg.querySelector(".viewer-index")
    const titleEl = msg.querySelector(".viewer-title")
    const sizeEl = msg.querySelector(".viewer-size")

    const updateLoadedImage = () => {
      if (sizeEl && (!naturalWidth || !naturalHeight)) {
        sizeEl.textContent = `${this.entities.image.naturalWidth || 0} x ${this.entities.image.naturalHeight || 0}`
      }
      this.operations.moveImageCenter()
    }

    this.entities.image.onload = updateLoadedImage
    this.entities.image.setAttribute("alt", alt || "")
    this.entities.image.setAttribute("data-idx", idx)
    this.entities.image.setAttribute("src", src)

    if (indexEl) indexEl.textContent = `[ ${showIdx} / ${total} ]`
    if (titleEl) titleEl.textContent = alt
    if (sizeEl) sizeEl.textContent = `${naturalWidth} x ${naturalHeight}`
    if (this.entities.image.complete) updateLoadedImage()
  }

  _getViewerSrc = item => item?.src || item?.getAttribute?.("src") || item?.currentSrc || item?.src || ""

  initThumbnailNav = (current = {}) => {
    const { idx: targetIdx, all = [] } = current
    this.entities.nav.textContent = ""
    const thumbnails = all.map((item, idx) => {
      const img = document.createElement("img")
      img.className = `viewer-thumbnail ${idx === targetIdx ? "select" : ""}`
      img.src = this._getViewerSrc(item)
      img.alt = item.alt || ""
      img.dataset.idx = String(idx)
      return img
    })
    this.entities.nav.append(...thumbnails)
  }

  _fileUrlToPath = src => {
    if (!/^file:\/\//i.test(src)) return src
    try {
      return decodeURIComponent(new URL(src).pathname)
    } catch {
      return src.replace(/^file:\/\//i, "")
    }
  }

  location = () => {
    let src = this.entities.image.getAttribute("src")
    if (this.utils.isNetworkImage(src)) {
      this.utils.openUrl(src)
    } else if (this.utils.isSpecialImage(src)) {
      alert("This Image Cannot Locate")
    } else {
      src = decodeURI(window.removeLastModifyQuery(src))
      src = this._fileUrlToPath(src)
      if (src) this.utils.showInFinder(src)
    }
  }

  show = async () => {
    if (this.isOpening) return
    this.isOpening = true
    try {
      document.activeElement?.blur?.()
      this.gallery.reset()
      const currentInfo = await this.gallery.initImageMsgGetter()
      if (!currentInfo?.total) {
        this.gallery.reset()
        return
      }

      this.initThumbnailNav(currentInfo)
      this.handleHotkey(false)
      this._setModalActive(true)
      this._blockTyporaChrome()
      this._startEventBlocker()
      this.utils.show(this.entities.viewer)
      this.dispatcher.execute("nextImage")
    } catch (error) {
      console.error("[ImageViewer] Failed to open", error)
      this.close()
    } finally {
      this.isOpening = false
    }
  }

  close = () => {
    this.handleHotkey(true)
    this._stopEventBlocker()
    this._restoreTyporaChrome()
    this._setModalActive(false)
    this.dispatcher.execute("play", true)
    this.utils.hide(this.entities.viewer)
    this.gallery.reset()
  }
}

module.exports = { ...original, plugin: MacosImageViewerPlugin }
