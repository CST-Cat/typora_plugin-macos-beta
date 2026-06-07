const original = require("../../right_click_menu.js")
const RightClickMenuPlugin = original.plugin

class MacosRightClickMenuPlugin extends RightClickMenuPlugin {
  _level1ItemsHTML = (extraAttrs = "") => {
    return this.config.MENUS.map(({ NAME, LIST = [] }, idx) => {
      if (LIST.length === 0) return ""

      const name = this.i18n._t("settings", NAME)
      const noExtraMenu = LIST.length === 1
      const caret = noExtraMenu ? "" : `<i class="fa fa-caret-right"></i>`
      const a = `<a role="menuitem"><span data-lg="Menu" data-localize="${name}">${name}</span>${caret}</a>`
      return noExtraMenu
        ? `<li${extraAttrs} data-key="${this.noExtraMenuGroupName}" data-value="${LIST[0]}" data-idx="${idx}">${a}</li>`
        : `<li${extraAttrs} class="has-extra-menu" data-key="${this.groupName}" data-idx="${idx}">${a}</li>`
    }).join("")
  }

  insertMacosNativeLevel1 = () => {
    const menu = document.querySelector("#context-menu")
    if (!menu) return false
    if (menu.querySelector(':scope > [data-plugin-macos-root="true"]')) return true

    const attrs = ' data-plugin-macos-root="true"'
    menu.insertAdjacentHTML("beforeend", `<li class="divider"${attrs}></li>${this._level1ItemsHTML(attrs)}`)
    return true
  }

  listenMacosNativeContextMenu = () => {
    const ensure = () => {
      if (this.insertMacosNativeLevel1()) return
      let retry = 0
      const timer = setInterval(() => {
        if (this.insertMacosNativeLevel1() || ++retry > 20) clearInterval(timer)
      }, 25)
    }
    ensure()
    const target = this.utils.entities.eContent || document.querySelector("content") || document.body
    target?.addEventListener("contextmenu", () => setTimeout(ensure), true)
    new MutationObserver(ensure).observe(document.body, { childList: true, subtree: true })
  }

  process = () => {
    this.utils.settings.autoSave(this)
    this.utils.eventHub.addEventListener(this.utils.eventHub.eventType.allPluginsHadInjected, () => {
      setTimeout(() => {
        this.listenMacosNativeContextMenu()
        this.insertLevel2()
        this.insertLevel3()
        this.listen()
      }, 500)
    })
  }

  listen = () => {
    const self = this
    const { menuManager } = this
    const level1Selector = "#context-menu"
    const level1Root = $(document)
    const selector = subSelector => `${level1Selector} ${subSelector}`

    level1Root.on("click", selector(`[data-key="${this.noExtraMenuGroupName}"]`), function () {
      const [fixedName, action] = (this.dataset.value || "").split(".")
      if (!fixedName || !action) return false
      self.utils.updatePluginDynamicActions(fixedName)
      self.callPluginDynamicAction(fixedName, action)
      self.hideMenuIfNeed()
    })

    level1Root.on("mouseenter", selector("[data-key]"), function () {
      if (self.groupName === this.dataset.key) {
        const idx = this.dataset.idx
        if (menuManager.isDifferentSecond(idx)) menuManager.clearAll()
        const secondMenu = document.querySelector(`.plugin-menu-second[data-idx="${idx}"]`)
        menuManager.setSecondMenu(secondMenu, this)
        self.showMenuItem(secondMenu, this)
      } else {
        menuManager.clearAll()
      }
    })

    $(".plugin-menu-second").on("mouseenter", "[data-key]", function () {
      menuManager.clearThirdMenu()
      document.querySelectorAll(".plugin-dynamic-act").forEach(el => el.remove())
      const fixedName = this.dataset.key
      const third = document.querySelector(`.plugin-menu-third[data-plugin="${fixedName}"]`)
      const noStaticActions = third && third.children.length === 0
      let dynamicActions = self.utils.updatePluginDynamicActions(fixedName)
      const noDynamicActions = !dynamicActions || dynamicActions.length === 0
      if (noDynamicActions && noStaticActions) {
        dynamicActions = [{ act_name: self.unavailableActName, act_value: self.unavailableActValue, act_disabled: true }]
      }
      if (dynamicActions && third) {
        const html = dynamicActions.map(act => self._thirdLiTemplate(act, true)).join("")
        third.insertAdjacentHTML("beforeend", html)
      }
      if (this.querySelector(`span[data-lg="Menu"]`)) {
        menuManager.setThirdMenu(third, this)
        self.showMenuItem(third, this)
      } else {
        menuManager.clearSecondItem()
      }
    }).on("click", "[data-key]", function () {
      const fixedName = this.dataset.key
      const action = this.dataset.value
      if (action) {
        self.callPluginDynamicAction(fixedName, action)
      } else {
        const plugin = self.utils.getBasePlugin(fixedName)
        if (!plugin || plugin.staticActions || plugin.getDynamicActions) return false
        plugin.call?.()
      }
      self.hideMenuIfNeed()
    })

    $(".plugin-menu-third").on("click", "[data-key]", function () {
      if (this.classList.contains("disabled")) return false
      const action = this.dataset.key
      const fixedName = this.parentElement.dataset.plugin
      self.callPluginDynamicAction(fixedName, action)
      self.hideMenuIfNeed(fixedName)
    })
  }
}

module.exports = { ...original, plugin: MacosRightClickMenuPlugin }
