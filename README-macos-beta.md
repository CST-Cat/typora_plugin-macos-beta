# Typora Plugin macOS Beta 移植说明

这是 `obgnail/typora_plugin` 的 macOS beta 移植分支。目标不是改写插件 API，也不是迁移到
`typora-community-plugin`，而是在尽量保留上游插件体系的前提下，让现有插件可以运行在 macOS 版
Typora 的 WebKit 页面里。

## 当前状态

- 平台定位：macOS beta，Windows/Linux 逻辑保持上游行为。
- 测试环境：macOS 版 Typora，页面入口为 `Typora.app/Contents/Resources/TypeMark/index.html`。
- 已验证能力：核心插件系统、配置读取写入、标签页、命令面板、右键菜单、偏好设置、markdownlint、公共弹窗/表格/表单组件、基础文件 RPC、buffered 命令执行。
- 仍属 beta：不是完整 Node/Electron 模拟层，少数依赖深度 Node 能力或 Electron 专有能力的插件可能还需要逐项适配。

## 移植路线

macOS 版 Typora 不是上游 Windows/Linux 使用的 Electron `window.html` 运行面。它的编辑器页面来自
`TypeMark/index.html`，页面环境是 WebKit，不能直接依赖 `reqnode()`、同步 `require()`、`fs-extra`、
`child_process` 这些 Node/Electron 能力。

因此本移植采用下面的链路：

```text
Typora.app/Contents/Resources/TypeMark/index.html
  -> loader.js
    -> entry.bundle.js
      -> shared-shims.js
      -> bundle-entry.js
      -> plugin/global/core/index.js
        -> 127.0.0.1:<random-port>/rpc + bearer token
          -> macOS helper
```

关键原则：

- 只向 Typora app 注入一条 loader，不把整个插件目录复制进 app 包。
- 插件文件安装到用户目录：
  `~/Library/Application Support/abnerworks.Typora/plugins/typora_plugin/`
- 浏览器侧只运行一个 macOS bundle：`plugin/macos/entry.bundle.js`。
- Node/Electron 能力由 `shared-shims.js` 和本地 helper 分担。
- helper 只监听 `127.0.0.1`，使用随机端口和 Bearer token，不暴露固定无认证端口。
- 不改造上游 `BasePlugin`、`BaseCustomPlugin`、`settings.default.toml`、`settings.user.toml` 的语义。

## 怎么安装

需要 Node.js `>=22`。第一次安装先构建 macOS bundle：

```bash
cd /path/to/typora_plugin
cd develop
npm install
npm run build:macos
cd ..
./install_macos.sh
```

如果 Typora 不在 `/Applications/Typora.app`：

```bash
./install_macos.sh --app /Applications/Typora.app
./install_macos.sh --root /Applications/Typora.app/Contents/Resources/TypeMark
```

安装后重启 Typora。正常加载后，可以在 WebKit 开发者工具里看到：

```js
window.__TP_MACOS__
```

卸载：

```bash
./uninstall_macos.sh
```

卸载会移除 loader 注入、LaunchAgent 和用户目录插件文件，默认保留
`~/.config/typora_plugin` 下的用户配置。

Typora 更新后如果插件消失，重新运行：

```bash
./install_macos.sh
```

因为 Typora 更新可能覆盖 `TypeMark/index.html`，需要重新补一条 loader 注入。

## 做了哪些改动

### 安装与启动

- 新增 `install_macos.sh` 和 `uninstall_macos.sh`。
- 新增 `plugin/macos/loader.js`，负责从 Typora 页面加载 `entry.bundle.js`。
- 新增 `plugin/macos/bundle-entry.js`，显式初始化 macOS runtime、注册插件模块并启动上游核心入口。
- 新增 `develop/build/macos-bundle.mjs` 和 `npm run build:macos`，使用 esbuild 生成浏览器 bundle。

### macOS runtime shim

- 新增 `plugin/macos/shared-shims.js`，作为 macOS shim 单一来源。
- 提供 `window.__TP_MACOS__`，包含平台检测、helper 初始化、RPC、模块 shim 和插件注册表。
- 覆盖常用模块：`path`、`fs`、`fs-extra`、`os`、`child_process`、`electron.shell`、`reqnode()`。
- 对不支持的 Node 模块抛出明确错误，避免静默返回空对象。

### helper 与安全边界

- 新增 `plugin/macos/helper/server.js`。
- helper 通过 LaunchAgent 启动，只绑定 `127.0.0.1`。
- 端口随机，连接信息写入用户插件目录，权限为 `600`。
- RPC 必须携带 Bearer token。
- 路径访问使用 `realpath` 和路径边界校验，避免前缀穿透和符号链接越界。
- 支持基础文件操作、ripgrep 搜索、自定义插件读取、buffered 命令执行。

### 插件兼容修复

- `utils.require()` 在 macOS 下走 bundle/自定义插件注册表，保持核心加载流程同步。
- `utils.fetch()` 在 macOS WebKit 下回退浏览器 `fetch`。
- `window_tab` 增加 macOS 布局适配，修复标签页消失、标题栏重叠、新建按钮无响应等问题。
- `sidebar_enhance` 的文件数量改为真实 DOM badge，修复窄侧边栏不显示统计的问题。
- `markdownlint` 增加 macOS Worker 包装和点击兜底，修复语法检查按钮无响应。
- 公共 UI 组件 `fast-window`、`fast-table`、`fast-form`、`fast-dialog` 的 Shadow DOM 样式在 macOS 下改用用户目录 `file://` 绝对路径，修复弹窗、表格、表单界面错位。

## 测试

```bash
cd develop
npm run build:macos
npm run test:macos
npm test
```

当前已通过：

- macOS helper token 校验。
- 路径白名单、前缀相似路径、符号链接越界拒绝。
- macOS loader/bundle artifact 检查。
- 上游全量 Node 测试。

## 已知限制

- `child_process.spawn` 目前是 buffered 兼容，不支持交互式 stdin。
- 依赖完整 Electron API 的功能需要逐项 shim，不能假设全部可用。
- helper 允许路径保持保守白名单，插件如果访问未授权路径会被拒绝。
- 这是 beta 移植仓库，建议先用测试目录验证常用插件，再迁移正式写作工作流。
