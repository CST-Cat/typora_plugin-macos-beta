const original = require("../../commander.js")
const CommanderPlugin = original.plugin

const quoteShellArg = arg => `'${String(arg).replace(/'/g, `'\\''`)}'`

const createPosixShell = (context, binary, flag) => {
  const normalizePath = path => path || ""
  const replaceArgs = cmd => {
    const replacements = {
      f: normalizePath(context.getFile()),
      d: normalizePath(context.getFolder()),
      m: normalizePath(context.getMountFolder()),
    }
    return cmd.replace(/\$([fdm])\b/g, match => `"${replacements[match.slice(1)]}"`)
  }
  return {
    context,
    getCommand: cmd => `${binary} ${flag} ${quoteShellArg(replaceArgs(cmd))}`,
  }
}

class MacosCommanderPlugin extends CommanderPlugin {
  SHELL = { CMD_BASH: "cmd/bash", ZSH: "zsh", POWER_SHELL: "powershell", GIT_BASH: "gitbash", WSL: "wsl" }
  AVAILABLE_SHELLS = new Set([this.SHELL.ZSH, this.SHELL.CMD_BASH])
  BUILTINS = (() => {
    return this.config.BUILTIN.filter(e => !e.disable && e.shell && this.AVAILABLE_SHELLS.has(e.shell))
  })()
  STRATEGIES = (() => {
    const ctx = {
      isWin: false,
      getFile: () => this.utils.getFilePath() || "",
      getFolder: () => this.utils.getCurrentDirPath() || "",
      getMountFolder: () => this.utils.getMountFolder() || "",
    }
    return {
      [this.SHELL.CMD_BASH]: createPosixShell(ctx, "bash", "-c"),
      [this.SHELL.ZSH]: createPosixShell(ctx, "zsh", "-lc"),
    }
  })()
  staticActions = (() => {
    const defaultAction = { act_name: this.i18n.t("act.toggle_panel"), act_value: "toggle_panel", act_hotkey: this.config.HOTKEY }
    const customActions = this.BUILTINS
      .filter(a => a.name && a.cmd)
      .map(a => ({ act_name: a.name, act_value: this.ACT_VALUE_PREFIX + a.name, act_hotkey: a.hotkey }))
    return [defaultAction, ...customActions]
  })()

  html = () => {
    const { CMD_BASH, ZSH } = this.SHELL
    const genShell = (shell, text) => `<option value="${shell}">${text}</option>`
    const shells = [genShell(ZSH, "Zsh"), genShell(CMD_BASH, "Bash")]
    const builtins = this.BUILTINS.map(e => `<option data-shell="${e.shell}" value="${this.utils.escape(e.cmd)}">${e.name}</option>`)
    return `
      <fast-window id="plugin-commander" window-title="${this.pluginName}" window-buttons="close|fa-times" hidden>
        <form id="plugin-commander-form">
          <div class="plugin-commander-input-wrap">
            <div class="ion-ios7-play plugin-commander-commit plugin-common-hidden" ty-hint="${this.i18n.t("runCommand")}"></div>
            <input type="text" class="plugin-commander-input" ty-hint="${this.i18n.t("$placeholder.envInfo")}">
          </div>
          <select class="plugin-commander-shell">${shells.join("")}</select>
          <select class="plugin-commander-builtin">${builtins.join("")}</select>
        </form>
        <div class="plugin-commander-output"><pre></pre></div>
      </fast-window>`
  }

  process = () => {
    this.entities.commit.addEventListener("click", () => this.commitExecute())
    this.entities.selectShell.addEventListener("change", () => this.entities.input.focus())
    this.entities.selectBuiltin.addEventListener("change", ev => {
      const option = ev.target.selectedOptions[0]
      if (!option) return
      this.entities.selectShell.value = option.dataset.shell
      this.entities.input.value = option.value
      this.entities.input.dispatchEvent(new Event("input"))
      this.entities.input.focus()
    })
    this.entities.input.addEventListener("input", ev => {
      const hasCMD = ev.target.value.trim()
      this.utils.toggleInvisible(this.entities.commit, !hasCMD)
      if (!hasCMD) this.entities.selectBuiltin.value = ""
    })
    this.entities.input.addEventListener("paste", ev => {
      const text = ev.clipboardData?.getData("text")
      if (!text || !/[\r\n]/.test(text)) return
      ev.preventDefault()
      const oneLine = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join("; ")
      document.execCommand("insertText", false, oneLine)
    })
    this.entities.form.addEventListener("submit", ev => {
      ev.preventDefault()
      this.commitExecute()
    })
    this.entities.form.addEventListener("keydown", ev => {
      const wantHide = ev.key === "Escape" || (ev.key === "Backspace" && this.config.BACKSPACE_TO_HIDE && !this.entities.input.value)
      if (wantHide) this.entities.panel.hide()
    })
    this.entities.panel.addEventListener("btn-click", ev => {
      if (ev.detail.action === "close") this.entities.panel.hide()
    })
  }
}

module.exports = { ...original, plugin: MacosCommanderPlugin }
