# Typora Plugin macOS 安装说明

这个 macOS 移植方案会尽量减少对 `Typora.app` 的修改。安装脚本只会向
Typora 的页面注入一条 loader 脚本，插件文件都会放在当前用户的
`Application Support` 目录下。

## 环境要求

- macOS 版 Typora，且页面入口位于 `Contents/Resources/TypeMark/index.html`
- Node.js >= 22
- 构建 bundle 前，需要先在 `develop/` 目录安装 npm 依赖
- 如果要使用原生插件右键菜单，需要系统里有 `swiftc`。安装脚本会自动编译
  `plugin/macos/native-menu/TyporaPluginNativeMenu.swift`。

## 安装

从当前项目的真实源码根目录执行：

```bash
cd /Users/cat/Documents/typora-plugin/typora_plugin/typora_plugin
cd develop
npm install
npm run build:macos
cd ..
./install_macos.sh
```

如果 Typora 不在默认位置，可以手动指定路径：

```bash
cd /Users/cat/Documents/typora-plugin/typora_plugin/typora_plugin
./install_macos.sh --app /Applications/Typora.app
./install_macos.sh --root /Applications/Typora.app/Contents/Resources/TypeMark
```

如果已经安装过依赖，并且 `plugin/macos/entry.bundle.js` 已经存在，可以直接运行：

```bash
cd /Users/cat/Documents/typora-plugin/typora_plugin/typora_plugin
./install_macos.sh
```

如果 bundle 不存在，`install_macos.sh` 会尝试自动执行 `develop` 里的
`npm run build:macos`。因此第一次安装前仍建议先手动跑完上面的 `npm install`。

安装脚本会执行以下操作：

1. 如果缺少 `plugin/macos/entry.bundle.js`，自动构建 macOS bundle。
2. 将 `plugin/` 复制到：
   `~/Library/Application Support/abnerworks.Typora/plugins/typora_plugin/plugin`
3. 创建 helper 的 LaunchAgent：
   `~/Library/LaunchAgents/io.github.obgnail.typora-plugin-helper.plist`
4. 如果 Swift companion 编译成功，创建原生插件菜单 LaunchAgent：
   `~/Library/LaunchAgents/io.github.obgnail.typora-plugin-native-menu.plist`
5. 写入私有 helper 连接文件：
   `~/Library/Application Support/abnerworks.Typora/plugins/typora_plugin/plugin/macos/helper/connection.json`
6. 向 Typora 的 `TypeMark/index.html` 注入一条 loader 脚本。

## 原生插件右键菜单

macOS 版 Typora 的普通右键菜单来自 WebKit/AppKit 原生层，浏览器 JS 不能直接把插件项塞进
Typora 已经弹出的原生菜单。这个移植版使用一个 native companion 实现接近 RClick 的效果：

- 普通右键仍然保留 Typora 原生菜单。
- 在 Typora 编辑区按 `Option + 右键` 会弹出一个真正的 macOS `NSMenu`，里面是上游
  `right_click_menu` 配置出来的插件菜单。
- 第一次启动可能需要在系统设置里给 `typora-plugin-native-menu` 辅助功能权限，否则它不能监听右键。

native companion 日志：

```bash
cat ~/.config/typora_plugin/native-menu-stdout.log
cat ~/.config/typora_plugin/native-menu-stderr.log
```

## 卸载

```bash
cd /Users/cat/Documents/typora-plugin/typora_plugin/typora_plugin
./uninstall_macos.sh
```

卸载脚本会移除 helper/native menu LaunchAgent、Typora 页面中的 loader 注入，以及复制到用户目录的
插件文件。默认会保留 `~/.config/typora_plugin` 下的用户配置。

## Typora 更新后

Typora 更新可能会覆盖 `TypeMark/index.html`。如果更新后插件不再加载，重新运行：

```bash
cd /Users/cat/Documents/typora-plugin/typora_plugin/typora_plugin
./install_macos.sh
```

脚本会重新补上那一条 loader 注入。已有插件文件和用户配置不会被删除，除非你手动删除它们。

## Helper 日志

```bash
cat ~/.config/typora_plugin/helper-stdout.log
cat ~/.config/typora_plugin/helper-stderr.log
cat ~/.config/typora_plugin/native-menu-stdout.log
cat ~/.config/typora_plugin/native-menu-stderr.log
launchctl list | grep typora-plugin
```

## 在 Typora 中调试

开启 Typora 的 WebKit 开发者工具，然后检查编辑器页面。正常加载后，页面里应该能看到：

```js
window.__TP_MACOS__
```

helper 只监听 `127.0.0.1`，端口随机，并且所有 RPC 请求都必须携带 Bearer token。
token 会写入上面的私有连接文件。
