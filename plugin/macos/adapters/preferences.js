const original = require("../../preferences/index.js")
const PreferencesPlugin = original.plugin

const ZSH_OPTION = "zsh"
const ZSH_LABEL = "Zsh"

const addZshTranslation = (i18nData) => {
  if (!i18nData?.commander) return i18nData
  return {
    ...i18nData,
    commander: {
      ...i18nData.commander,
      "$option.BUILTIN.shell.zsh": i18nData.commander["$option.BUILTIN.shell.zsh"] || ZSH_LABEL,
    },
  }
}

const walkFields = (boxes, visitor) => {
  for (const box of boxes || []) {
    for (const field of box.fields || []) {
      visitor(field)
      walkFields(field.nestedBoxes, visitor)
      walkFields(field.subSchema, visitor)
      for (const tab of field.tabs || []) {
        walkFields(tab.schema, visitor)
      }
    }
  }
}

const patchCommanderSchema = (schemas) => {
  const commander = schemas?.commander
  if (!Array.isArray(commander)) return schemas

  walkFields(commander, field => {
    if (field.key !== "BUILTIN" || field.type !== "table") return

    field.defaultValues = {
      ...field.defaultValues,
      shell: ZSH_OPTION,
    }

    walkFields(field.nestedBoxes, nestedField => {
      if (nestedField.key !== "shell" || nestedField.type !== "select") return
      nestedField.options = {
        ...nestedField.options,
        [ZSH_OPTION]: nestedField.options?.[ZSH_OPTION] || ZSH_LABEL,
      }
    })
  })

  return schemas
}

const syncGlobalDarkMode = (plugin, enable) => {
  if (typeof enable !== "boolean") return

  const globalSetting = plugin.utils.getGlobalSetting()
  if (globalSetting) globalSetting.DARK_MODE = enable

  const dark = plugin.utils.getBasePlugin("dark")
  const useFullPageFilter = hasFullPageDarkFilter(enable, dark)
  document.body.classList.toggle("plugin-dark-mode", enable && !useFullPageFilter)
  if (!dark) return

  dark.config.DARK_DEFAULT = enable
  if (enable) {
    dark.enableDarkMode()
  } else {
    dark.disableDarkMode()
  }
}

const patchGlobalDarkModeSettingHandle = (plugin) => {
  const settings = plugin.utils.settings
  if (settings.__typoraPluginMacosDarkModePatched) return false

  const originalHandle = settings.handle.bind(settings)
  settings.handle = async (fixedName, handler) => {
    let shouldSyncDarkMode = false
    let darkMode

    const wrappedHandler = (pluginSettings, allSettings) => {
      handler(pluginSettings, allSettings)
      if (fixedName !== "global") return

      const value = allSettings?.global?.DARK_MODE
      if (typeof value !== "boolean") return

      shouldSyncDarkMode = true
      darkMode = value
      allSettings.dark = allSettings.dark || {}
      allSettings.dark.DARK_DEFAULT = value
    }

    const result = await originalHandle(fixedName, wrappedHandler)
    if (shouldSyncDarkMode) syncGlobalDarkMode(plugin, darkMode)
    return result
  }

  settings.__typoraPluginMacosDarkModePatched = true
  return true
}

const hasFullPageDarkFilter = (enable, dark) => {
  if (!enable || !dark) return false
  if (typeof window === "undefined") return true
  return window.matchMedia?.("(prefers-color-scheme: light)")?.matches ?? true
}

class MacosPreferencesPlugin extends PreferencesPlugin {
  _baseProcess = this.process
  _settingsHandlePatched = false

  _getSchemas = () => {
    const compile = require("../../preferences/schemas.js")
    const schemas = compile(this.entities.form.dsl, addZshTranslation(this.i18n.allData))
    return patchCommanderSchema(schemas)
  }

  process = () => {
    this._patchSettingsHandle()
    this._baseProcess()
    this._syncGlobalDarkMode(this.utils.getGlobalSetting()?.DARK_MODE)
    this.utils.eventHub?.addEventListener(this.utils.eventHub.eventType.allPluginsHadInjected, () => {
      this._syncGlobalDarkMode(this.utils.getGlobalSetting()?.DARK_MODE)
    })
  }

  _patchSettingsHandle = () => {
    if (this._settingsHandlePatched) return
    this._settingsHandlePatched = patchGlobalDarkModeSettingHandle(this)
  }

  _syncGlobalDarkMode = enable => syncGlobalDarkMode(this, enable)
}

module.exports = {
  ...original,
  plugin: MacosPreferencesPlugin,
  addZshTranslation,
  hasFullPageDarkFilter,
  patchCommanderSchema,
  patchGlobalDarkModeSettingHandle,
  syncGlobalDarkMode,
}
