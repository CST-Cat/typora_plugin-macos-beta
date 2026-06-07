class DrawIOPlugin extends BasePlugin {
  INTERACTION_TYPE = {
    default: {},
    showOnly: { highlight: "#0000ff", nav: false, edit: null, editable: false, lightbox: false },
    clickable: { highlight: "#0000ff", nav: false, resize: true, edit: null, editable: false, toolbar: null, "toolbar-nohide": true },
    showToolbar: {
      highlight: "#0000ff", nav: true, resize: true, edit: null, editable: true, lightbox: false,
      zoom: "1", toolbar: "zoom lightbox layers", "toolbar-position": "inline", "toolbar-nohide": true,
    },
  }
  _memorizedFetch = this.utils.memoizeLimited(async url => {
    const resp = await this.utils.fetch(url, { timeout: this.config.SERVER_TIMEOUT, proxy: this.config.PROXY })
    if (!resp.ok) {
      const text = await resp.text().catch(() => "")
      throw new Error(`${resp.status} ${resp.statusText}\n${text}`)
    }
    return resp.text()
  }, this.config.CACHED_URL_COUNT)

  style = () => true

  hotkey = () => [{ hotkey: this.config.HOTKEY, callback: this.call }]

  call = () => this.utils.insertBlockCode(null, this.config.LANGUAGE, this.config.TEMPLATE)

  process = () => {
    const parser = this.utils.thirdPartyDiagramParser
    parser.register({
      lang: this.config.LANGUAGE,
      mappingLang: "javascript",
      destroyWhenUpdate: false,
      interactiveMode: this.config.INTERACTIVE_MODE,
      metaConfigSchema: {
        ...parser.helpers.styleMetaConfigSchema.wrapDefaultStyle({
          height: this.config.DEFAULT_FENCE_HEIGHT,
          backgroundColor: this.config.DEFAULT_FENCE_BACKGROUND_COLOR,
        }),
        interaction: { type: "string", enum: ["default", "showOnly", "clickable", "showToolbar"], default: "showOnly" },
      },
      checkSelector: ".plugin-drawio-content",
      wrapElement: `<div class="plugin-drawio-content"></div>`,
      lazyLoadFunc: this.lazyLoad,
      beforeRenderFunc: null,
      renderStyleGetter: parser.helpers.renderStyle.base,
      createFunc: this.create,
      updateFunc: null,
      destroyFunc: null,
      beforeExportToNative: null,
      beforeExportToHTML: this.beforeExportToHTML,
      exportStyleGetter: this.getStyleContent,
      versionGetter: null,
    })
  }

  create = async ($wrap, content, meta) => {
    const graphConfig = this.utils.safeEval(content)
    if (!graphConfig || typeof graphConfig !== "object") {
      throw new Error(this.i18n.t("error.missingSource"))
    }
    if (!graphConfig.source && !graphConfig.xml) {
      throw new Error(this.i18n.t("error.missingSource"))
    }
    if (!graphConfig.xml) {
      graphConfig.xml = await this._getResource(
        graphConfig.source,
        async (source) => {
          $wrap[0].innerHTML = "Fetching Network Resource..."
          return this._memorizedFetch(source)
        },
        async (source) => {
          // $wrap[0].innerHTML = "Fetching Local Resource..."
          const dir = this.utils.getLocalRootUrl()
          const path = this.utils.Package.Path.resolve(dir, source)
          return this.utils.Package.FsExtra.readFile(path, "utf-8")
        },
      )
    }

    const presetConfig = this.INTERACTION_TYPE[meta.interaction]
    const mxGraphData = this._compactGraphConfig({ ...presetConfig, ...graphConfig })
    return this._render($wrap[0], mxGraphData)
  }

  _compactGraphConfig = graphConfig => Object.fromEntries(
    Object.entries(graphConfig).filter(([, value]) => value !== null && value !== undefined),
  )

  _getResource = async (source, onRemote, onLocal) => {
    const isNetwork = this.utils.isNetworkURI(source)
    try {
      const fetchFn = isNetwork ? onRemote : onLocal
      return await fetchFn(source)
    } catch (e) {
      const msg = this.i18n.t(isNetwork ? "error.getFileFailedFromNetwork" : "error.getFileFailedFromLocal")
      throw new Error(`${msg}: ${source}\n\n${e}`)
    }
  }

  _render = async (container, mxGraphData) => {
    this._assertGraphViewer()
    const jsonStr = JSON.stringify(mxGraphData)
    const escaped = this.utils.escape(jsonStr)
    container.innerHTML = `<div class="mxgraph" style="max-width:100%; margin: 26px auto 0;" data-mxgraph="${escaped}"></div>`
    await this.utils.sleep(0)
    const graph = container.querySelector(".mxgraph")
    try {
      window.GraphViewer.createViewerForElement(graph)
    } catch (error) {
      throw new Error(`Draw.io viewer failed: ${error.message || error}\n${error.stack || ""}`)
    }
    await this.utils.sleep(50)
    this._assertRendered(container)
    return container
  }

  _assertGraphViewer = () => {
    if (!window.GraphViewer || typeof window.GraphViewer.processElements !== "function") {
      throw new Error("Draw.io viewer is not loaded. Check drawIO.RESOURCE_URI.")
    }
  }

  _assertRendered = (container) => {
    const message = container.textContent?.trim()
    if (message === "Type error") {
      throw new Error("Draw.io viewer failed with Type error. Check the graphConfig XML/source format.")
    }
  }

  lazyLoad = async () => {
    const from = this.config.RESOURCE_URI
    const path = this.utils.isNetworkURI(from) ? from : `file:///${this.utils.Package.Path.resolve(from)}`
    await $.getScript(path)
    this._assertGraphViewer()
    this._patchSanitizer()
    window.GraphViewer.prototype.toolbarZIndex = 7
  }

  _patchSanitizer = () => {
    const graph = window.Graph
    if (!graph || graph.__typoraPluginSanitizerPatched || typeof graph.domPurify !== "function") return

    graph.domPurify = (value, inPlace) => {
      return this._fallbackSanitizeHtml(value, inPlace)
    }
    graph.__typoraPluginSanitizerPatched = true
  }

  _fallbackSanitizeHtml = value => {
    if (value?.nodeType) {
      return value
    }
    if (typeof value === "string") {
      return this.utils.escape(value).replace(/\r?\n/g, "<br>")
    }
    if (value?.textContent) {
      return this.utils.escape(value.textContent).replace(/\r?\n/g, "<br>")
    }
    return ""
  }

  beforeExportToHTML = (preview, instance) => {
    const graph = preview.querySelector(".mxgraph")
    if (graph) {
      this._fixDiagramForExport(graph, graph.querySelector("svg"))
      graph.removeAttribute("data-mxgraph")
      graph.querySelectorAll(":scope > *:not(svg)").forEach(el => el.remove())
    }
  }

  /**
   * TODO: Ugly Code.
   * Fixes Draw.io SVG truncation, scaling, and whitespace issues for PDF export.
   *
   * Logic:
   * 1. Unlock Containers: Recursively removes fixed width/height constraints from parent containers to enable responsive resizing.
   * 2. Filter Content: Iterates through SVG elements, strictly ignoring invisible items and transparent placeholders (ghost elements).
   * 3. Coordinate Projection: Calculates the precise bounding box by projecting screen coordinates (getBoundingClientRect) back to the SVG coordinate system using the Inverse Screen CTM.
   * 4. Apply ViewBox: Sets a tight-fitting `viewBox` based on the calculated boundaries, ensuring the diagram is fully visible and centered.
   */
  _fixDiagramForExport = (mxGraphEl, svgEl) => {
    if (!mxGraphEl || !svgEl) return

    let parent = mxGraphEl
    while (parent && !parent.classList.contains("md-diagram-panel")) {
      parent.style.cssText = ""
      parent.removeAttribute("width")
      parent.classList.add("fix-drawio-unlocked")
      parent = parent.parentElement
    }

    const screenCTM = svgEl.getScreenCTM()
    if (!screenCTM) return

    const matrix = screenCTM.inverse()
    const pt = svgEl.createSVGPoint()
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    let hasContent = false

    const elements = svgEl.querySelectorAll("path, rect, circle, ellipse, text, image, polygon, polyline")
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i]
      const style = window.getComputedStyle(el)

      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue

      const noFill = !style.fill || style.fill === "none" || style.fill === "transparent" || style.fill.includes("rgba(0, 0, 0, 0)")
      const noStroke = !style.stroke || style.stroke === "none" || style.stroke === "transparent" || parseFloat(style.strokeWidth) === 0
      if (noFill && noStroke) continue

      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue

      hasContent = true
      const corners = [
        { x: rect.left, y: rect.top },
        { x: rect.right, y: rect.top },
        { x: rect.right, y: rect.bottom },
        { x: rect.left, y: rect.bottom },
      ]
      for (const corner of corners) {
        pt.x = corner.x
        pt.y = corner.y
        const sp = pt.matrixTransform(matrix)
        minX = Math.min(minX, sp.x)
        minY = Math.min(minY, sp.y)
        maxX = Math.max(maxX, sp.x)
        maxY = Math.max(maxY, sp.y)
      }
    }

    if (hasContent) {
      const padding = 10
      const viewBox = [
        Math.floor(minX - padding),
        Math.floor(minY - padding),
        Math.ceil(maxX - minX + padding * 2),
        Math.ceil(maxY - minY + padding * 2),
      ].join(" ")

      svgEl.setAttribute("viewBox", viewBox)
      svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet")
      svgEl.classList.add("fix-drawio-svg")
      svgEl.removeAttribute("width")
      svgEl.removeAttribute("height")
      svgEl.removeAttribute("style")
    }
  }

  getStyleContent = () => this.utils.getStyleText(this.fixedName)
}

module.exports = {
  plugin: DrawIOPlugin,
}
