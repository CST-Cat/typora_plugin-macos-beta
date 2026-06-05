const createSheet = (name) => {
  const targetSheet = [...document.styleSheets].find(s => s.href?.includes(name))
  if (!targetSheet) return null
  const sheet = new CSSStyleSheet()
  Array.from(targetSheet.cssRules).forEach(rule => sheet.insertRule(rule.cssText))
  return sheet
}

const sharedSheets = ["font-awesome", "ionicons"].map(createSheet).filter(Boolean)

const toFileUrl = path => `file://${String(path).split("/").map(encodeURIComponent).join("/")}`

const componentStyleLink = name => {
  const href = (typeof window !== "undefined" && window.__TP_MACOS__)
    ? toFileUrl(`${global.dirname}/plugin/global/core/components/${name}/index.css`)
    : `./plugin/global/core/components/${name}/index.css`
  return `<link rel="stylesheet" href="${href}" crossorigin="anonymous">`
}

module.exports = {
  componentStyleLink,
  sharedSheets,
}
