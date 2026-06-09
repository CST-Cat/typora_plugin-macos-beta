const assert = require("node:assert/strict")
const { describe, it } = require("node:test")

global.BasePlugin = global.BasePlugin || class {}

const {
  addZshTranslation,
  hasFullPageDarkFilter,
  patchCommanderSchema,
  patchGlobalDarkModeSettingHandle,
  syncGlobalDarkMode,
} = require("../../plugin/macos/adapters/preferences.js")
const { withMacosBuiltins } = require("../../plugin/macos/adapters/commander.js")
const { createLocalTranslator } = require("../../plugin/macos/adapters/command_palette.js")

const getBuiltinField = (schemas) => schemas.commander
  .flatMap(box => box.fields || [])
  .find(field => field.key === "BUILTIN")

const getShellField = (builtinField) => builtinField.nestedBoxes
  .flatMap(box => box.fields || [])
  .find(field => field.key === "shell")

describe("macOS preferences adapter", () => {
  it("adds zsh to the commander schema without changing upstream schemas.js", () => {
    const schemas = require("./fixtures/schemas.js").get("zh-CN")
    const builtinBefore = getBuiltinField(schemas)
    const shellBefore = getShellField(builtinBefore)

    assert.equal(builtinBefore.defaultValues.shell, "cmd/bash")
    assert.equal(shellBefore.options.zsh, undefined)

    patchCommanderSchema(schemas)

    const builtinAfter = getBuiltinField(schemas)
    const shellAfter = getShellField(builtinAfter)
    assert.equal(builtinAfter.defaultValues.shell, "zsh")
    assert.equal(shellAfter.options.zsh, "Zsh")
  })

  it("adds zsh translation data through the adapter layer", () => {
    const i18nData = { commander: { "$option.BUILTIN.shell.cmd/bash": "CMD/Bash" } }
    const patched = addZshTranslation(i18nData)

    assert.equal(i18nData.commander["$option.BUILTIN.shell.zsh"], undefined)
    assert.equal(patched.commander["$option.BUILTIN.shell.zsh"], "Zsh")
  })

  it("mirrors global DARK_MODE into dark DARK_DEFAULT in one settings write", async () => {
    const writes = []
    const fakePlugin = {
      utils: {
        settings: {
          async handle(fixedName, handler) {
            const allSettings = { global: {}, dark: {} }
            handler(allSettings[fixedName], allSettings)
            writes.push(allSettings)
          },
        },
        getGlobalSetting: () => ({}),
        getBasePlugin: () => null,
      },
    }
    const oldDocument = global.document
    global.document = { body: { classList: { toggle() {} } } }

    try {
      patchGlobalDarkModeSettingHandle(fakePlugin)
      await fakePlugin.utils.settings.handle("global", settings => {
        settings.DARK_MODE = true
      })
    } finally {
      global.document = oldDocument
    }

    assert.equal(writes[0].global.DARK_MODE, true)
    assert.equal(writes[0].dark.DARK_DEFAULT, true)
  })

  it("applies global DARK_MODE through the loaded dark plugin as the single full-page filter", () => {
    const calls = []
    const globalSetting = { DARK_MODE: false }
    const dark = {
      config: { DARK_DEFAULT: false },
      enableDarkMode: () => calls.push("enable"),
      disableDarkMode: () => calls.push("disable"),
    }
    const fakePlugin = {
      utils: {
        getGlobalSetting: () => globalSetting,
        getBasePlugin: fixedName => fixedName === "dark" ? dark : null,
      },
    }
    const oldDocument = global.document
    let toggled
    global.document = { body: { classList: { toggle: (cls, enable) => toggled = [cls, enable] } } }

    try {
      syncGlobalDarkMode(fakePlugin, true)
    } finally {
      global.document = oldDocument
    }

    assert.deepEqual(toggled, ["plugin-dark-mode", false])
    assert.equal(globalSetting.DARK_MODE, true)
    assert.equal(dark.config.DARK_DEFAULT, true)
    assert.deepEqual(calls, ["enable"])
  })

  it("falls back to plugin panel dark mode when the dark plugin is unavailable", () => {
    const globalSetting = { DARK_MODE: false }
    const fakePlugin = {
      utils: {
        getGlobalSetting: () => globalSetting,
        getBasePlugin: () => null,
      },
    }
    const oldDocument = global.document
    let toggled
    global.document = { body: { classList: { toggle: (cls, enable) => toggled = [cls, enable] } } }

    try {
      syncGlobalDarkMode(fakePlugin, true)
    } finally {
      global.document = oldDocument
    }

    assert.deepEqual(toggled, ["plugin-dark-mode", true])
  })

  it("does not claim a full-page filter when the light color-scheme media query is false", () => {
    const oldWindow = global.window
    global.window = { matchMedia: () => ({ matches: false }) }
    try {
      assert.equal(hasFullPageDarkFilter(true, {}), false)
    } finally {
      global.window = oldWindow
    }
  })
})

describe("macOS commander adapter", () => {
  it("injects the macOS Terminal builtin without mutating default settings", () => {
    const builtins = [
      { name: "Default", disable: false, shell: "cmd/bash", cmd: "" },
      { name: "VScode", disable: false, shell: "cmd/bash", cmd: "code $f" },
    ]

    const patched = withMacosBuiltins(builtins)
    assert.deepEqual(builtins.map(item => item.name), ["Default", "VScode"])
    assert.deepEqual(patched.map(item => item.name), ["Default", "macOS Terminal", "VScode"])
    assert.equal(patched[1].shell, "zsh")
  })

  it("does not duplicate the macOS Terminal builtin", () => {
    const builtins = [
      { name: "Default", disable: false, shell: "cmd/bash", cmd: "" },
      { name: "macOS Terminal", disable: false, shell: "zsh", cmd: "cd $d && open -a Terminal ." },
    ]

    const patched = withMacosBuiltins(builtins)
    assert.equal(patched.filter(item => item.name === "macOS Terminal").length, 1)
  })
})

describe("macOS command palette adapter", () => {
  it("keeps adapter-only translations outside global locale files", () => {
    const t = createLocalTranslator({
      locale: "zh-CN",
      t: key => key,
    })

    assert.equal(t("placeholder", "fallback"), "输入 ? 查看可用命令")
    assert.equal(t("line.go", "fallback", { line: 42 }), "跳转到第 42 行")
  })
})
