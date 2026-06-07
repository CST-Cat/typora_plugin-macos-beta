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

class MacosPreferencesPlugin extends PreferencesPlugin {
  _getSchemas = () => {
    const compile = require("../../preferences/schemas.js")
    const schemas = compile(this.entities.form.dsl, addZshTranslation(this.i18n.allData))
    return patchCommanderSchema(schemas)
  }
}

module.exports = {
  ...original,
  plugin: MacosPreferencesPlugin,
  addZshTranslation,
  patchCommanderSchema,
}
