# macOS 三大图表插件修复记录

日期：2026-06-07

相关提交：`c1d72743 Fix macOS diagram rendering smoke`

后续修正：DrawIO、Marp 的 macOS 兼容逻辑已从原插件文件迁回 macOS bundle adapter；`plugin/drawIO.js`、`plugin/marp/index.js`、`plugin/plantUML.js` 保持上游原版形态。

再次修正：Marp 后续出现“页面显示不全、整体偏右”的视觉问题。确认不是屏幕太小，而是 Marp 生成的 inline SVG / `foreignObject` 在 Typora WebKit + Shadow DOM 里没有正确执行自带 browser polyfill；修复仍放在 `macos-marp-adapter`，不改上游 Marp 插件文件。

涉及插件：

- DrawIO：上游原插件 `plugin/drawIO.js`，macOS 适配在 `develop/build/macos-bundle.mjs` 的 `macos-drawio-adapter`
- PlantUML：上游原插件 `plugin/plantUML.js`，macOS 适配在 bundle 的 `zlib` / `Buffer` shim 和默认配置
- Marp：上游原插件 `plugin/marp/index.js`，macOS 适配在 `develop/build/macos-bundle.mjs` 的 `macos-marp-adapter`

这是一份纪念性质的技术记录。它记录的是 macOS Typora 插件移植过程中，DrawIO、PlantUML、Marp 三个大图表插件从报错、空白、反复刷新，到重新能在 Typora WebKit 环境里渲染出来的过程。

## 背景

macOS Typora 的运行环境不是 Windows/Linux 版 Typora 插件原先依赖的 Electron + Node 页面，而是 Typora 自带的 WebKit/TypeMark 页面：

```text
/Applications/Typora.app/Contents/Resources/TypeMark/index.html
```

这意味着页面里不能直接假设有完整 Node runtime，也不能直接照搬所有 CommonJS 依赖。macOS 版插件需要经过 browser bundle，并由一组 shim 和 helper bridge 补齐能力。

这次出问题的三个插件都属于“重型第三方图表渲染器”：

- DrawIO 要加载 diagrams.net 的 `GraphViewer`。
- PlantUML 要把文本压缩编码后交给 PlantUML server。
- Marp 要加载 `marp-core`，生成幻灯片 DOM 和 CSS。

它们共同踩中了 macOS WebKit 移植里最容易出问题的三类坑：

- 浏览器 bundle 缺少 Node 内置模块能力。
- 第三方库在 WebKit 页面的全局对象、loader、sanitizer 上和预期不一致。
- 图表渲染失败后，错误状态会在编辑刷新时反复触发，干扰 Typora 正常编辑体验。

## 现场症状

### DrawIO

最初表现为渲染区只显示：

```text
Type error
```

这个错误信息太短，无法直接定位是 XML、GraphViewer、sanitize 还是资源加载问题。

### PlantUML

最初表现为 `plantuml` code fence 渲染失败，错误栈落在 macOS bundle 内部：

```text
fail@file:///Applications/Typora.app/Contents/Resources/TypeMark/typora-plugin-macos/entry.bundle.js:6863:24
get@file:///Applications/Typora.app/Contents/Resources/TypeMark/typora-plugin-macos/entry.bundle.js:6871:22
encode@file:///Applications/Typora.app/Contents/Resources/TypeMark/typora-plugin-macos/entry.bundle.js:140151:40
```

当时曾经考虑过把 PlantUML 合并进 helper RPC。但最后判断：PlantUML 上游原版就是使用外部 PlantUML server，通常习惯端口是 `8080`。把它硬塞进不固定端口的 helper，反而会让行为偏离上游，也增加维护复杂度。

最终方向是：保留上游式 PlantUML server 模式，macOS bundle 只补齐它需要的 `zlib` 和 `Buffer` 能力。

### Marp

最初表现为 `marp` code fence 渲染失败，错误栈只剩 bundle 位置：

```text
@file:///Applications/Typora.app/Contents/Resources/TypeMark/typora-plugin-macos/entry.bundle.js:137908:42
@file:///Applications/Typora.app/Contents/Resources/TypeMark/typora-plugin-macos/entry.bundle.js:1962:47

Diagram Parser Settings:
    language: marp
    mappingLanguage: markdown
    diagramVersion: marp-core@4.2.0
```

这类错误容易造成一个糟糕副作用：在文档底部编辑 Callouts 时，Typora 会刷新上方失败的图表块，用户视角像是“突然跳回上面”。所以这个问题不只是图表坏了，也会破坏普通编辑体验。

## 修复原则

本次修复遵循几个判断：

1. PlantUML 回到上游习惯，使用 `http://localhost:8080`。
2. macOS bundle 补运行时能力，不把 PlantUML 变成 helper 私有协议。
3. DrawIO、Marp 的第三方库要在 WebKit 页面里适配，而不是让错误裸奔。
4. lazy load 失败不能永久污染插件状态，后续应该能重试。
5. 图表失败后，相同内容的失败块不要在无关编辑时反复渲染。
6. 修复必须用 Typora 实际界面验证，不只看代码。

## 关键改动

### 1. macOS bundle 补齐 Node 兼容能力

文件：

- `develop/build/macos-bundle.mjs`
- `plugin/macos/shared-shims.js`
- `develop/package.json`
- `develop/package-lock.json`

关键点：

- 将 `buffer`、`url`、`util` 从 unsupported 模块改成 shim 模块。
- 新增虚拟 `zlib` 模块。
- 使用 `fflate` 在浏览器 bundle 内实现 `deflateRawSync` 所需能力。
- `shared-shims.js` 里补 `Buffer.from(...)`、base64 编解码、URL/util 兼容函数。

这一步是 PlantUML 恢复上游编码路径的基础。

### 2. PlantUML 恢复上游式 server 渲染

文件：

- `plugin/plantUML.js`
- `plugin/global/settings/settings.default.toml`

核心逻辑：

```js
const zlib = require("zlib")
const encode = (text) => zlib.deflateRawSync(text)
  .toString("base64")
  .replace(/[A-Za-z0-9+/]/g, toUML)

const url = `${this.config.SERVER_URL}/${this.config.OUTPUT_FORMAT}/${encode(content)}`
```

配置恢复为：

```toml
SERVER_URL = "http://localhost:8080"
OUTPUT_FORMAT = "svg"
```

文档里的安装提示也回到上游常见方式：

```sh
docker pull plantuml/plantuml-server:jetty
docker run -d --name plantuml-server -p 8080:8080 plantuml/plantuml-server:jetty
```

验证时本机也启动了 PlantUML server，`localhost:8080` 返回了 SVG。

### 3. DrawIO 处理 GraphViewer 的 WebKit 兼容问题

文件：

- `develop/build/macos-bundle.mjs`
- `plugin/macos/entry.bundle.js`

关键点：

- 原 `plugin/drawIO.js` 保持上游逻辑，不在这里塞 macOS 专用代码。
- macOS bundle 注册 `macos-drawio-adapter`，导出继承自上游插件的子类。
- adapter 在实例层调整 `showOnly` 配置，过滤 `null` / `undefined` 字段，避免把无效字段塞给 GraphViewer。
- adapter 渲染时使用 `GraphViewer.createViewerForElement(graph)`，并捕获更完整的错误栈。
- 如果 GraphViewer 仍输出 `Type error`，主动转成可读错误。
- adapter patch `window.Graph.domPurify`，为 macOS WebKit 环境提供 fallback sanitize。

这让 DrawIO 不再只留下 “Type error” 四个字，也让内联 XML smoke 示例能稳定渲染。

### 4. Marp 在 WebKit 页面里稳定初始化

文件：

- `develop/build/macos-bundle.mjs`
- `plugin/macos/entry.bundle.js`

关键点：

- 原 `plugin/marp/index.js` 保持上游逻辑，不在这里塞 macOS 专用代码。
- macOS bundle 注册 `macos-marp-adapter`，导出继承自上游插件的子类。
- adapter lazy load 时先 patch MathJax loader，避免缺少 `preLoad` 时初始化失败。
- adapter 在 `marp.render(content)` 后，把 CSS 和 HTML 放进 Shadow DOM；Shadow DOM 不可用时再退回普通 DOM。
- adapter 图片路径统一转成绝对路径，兼容本地 Markdown 文件引用图片。
- adapter 额外注入响应式 CSS，让 Marp 生成的固定尺寸 SVG 按 Typora 写作区宽度缩放。
- adapter 执行 Marp render 输出里的内嵌 browser script。原因是用 `innerHTML` 写入 Shadow DOM 时，`<script>` 默认不会自动执行；而 Marp 自带的 browser script 正好负责 WebKit / Safari 下 `foreignObject` 内容缩放和定位。
- adapter 增加 `fitSlides(host, root)` 兜底：当 Marp 自带 polyfill 尚未接管时，根据 SVG `viewBox` 和实际宽度计算 scale，把 `foreignObject > section` 缩放到 Typora 写作区内。
- `destroy` 明确清空实例内容。

这让 Marp 的幻灯片能在 Typora 中渲染为真实 DOM，而不是失败面板。

### 4.1 Marp 偏右和显示不全的后续修复

文件：

- `develop/build/macos-bundle.mjs`
- `plugin/macos/entry.bundle.js`
- `test/diagram-smoke.md`

后续在 `diagram-smoke.md` 里把 Marp 示例加复杂后，Typora 里出现了两个新症状：

- 幻灯片内容显示不全，像被右侧裁掉。
- 整体偏右，标题和正文不在预期的页面边界内。

先尝试过“加百分比”，但这暴露出一个反例：不能把百分比写到 Marp 的 `section` 上。Marp 主题本来用 `section { width: 1280px; height: 720px; }` 定义幻灯片画布；把它改成 `width: 100%` 会让内层 slide 尺寸和外层 SVG `viewBox="0 0 1280 720"` 脱节，反而更容易出现内容漂移。

最终判断：

- 百分比应该作用在外层预览容器或 SVG 上，而不是破坏 Marp 自己的 1280x720 页面语义。
- Marp 的 render 结果中包含 browser polyfill script，它用于处理 WebKit/Safari 下的 inline SVG 和 `foreignObject` 缩放。
- 原插件通过 `shadowRoot.innerHTML = style + html` 写入内容，script 在这个路径下不会自动执行，所以 WebKit 缩放逻辑没有生效。

最终修复：

- `test/diagram-smoke.md` 移除 `section { width: 100%; max-width: 100%; min-height: auto; }`，恢复 Marp slide 的固定画布语义。
- `macos-marp-adapter` 增加 `runEmbeddedScripts(root)`，把 inert script 替换成真实 script，让 Marp 自带 browser polyfill 执行。
- `macos-marp-adapter` 保留 `fitSlides(host, root)` 兜底；如果已经检测到 Marp polyfill 给 section 写入了 `matrix(...)` transform，就不再重复缩放。
- 外层 SVG 仍由 adapter 加 `width: 100%`、`height: auto`、边框和轻微阴影，让 Typora 里能看出每一页幻灯片的边界。

这个修复继续遵守边界：`plugin/marp/index.js` 不动，macOS WebKit 差异只在 bundle adapter 里处理。

### 5. 图表解析器减少失败刷新干扰

文件：

- `plugin/global/core/utils/diagramParser.js`
- `plugin/global/core/utils/thirdPartyDiagramParser.js`
- `plugin/global/core/utils/index.js`

关键点：

- `DiagramParser` 增加失败渲染缓存：相同 `cid + lang + content` 已经失败并且错误面板还在时，不重复渲染。
- 错误信息补全：当浏览器 stack 没有包含 `Error.message` 时，错误面板仍显示 `Error: xxx`。
- `ThirdPartyDiagramParser` 捕获错误时保留 message + stack + parser settings。
- `utils.once` 失败后会清除 called 状态，允许 lazy load 下次重试。

这部分是体验修复的关键。否则一个插件第一次 lazy load 失败，就可能被 `once` 永久记住失败状态。

## Smoke 文档

新增：

- `test/diagram-smoke.md`
- `test/display.md`

`diagram-smoke.md` 专门放三大插件的最小可见验证：

- DrawIO：Typora -> Loader -> Helper RPC -> Plugins 流程图。
- PlantUML：带 grouped boxes、`alt`、`loop`、note 和 `localhost:8080` 的复杂时序图。
- Marp：四页幻灯片 smoke sample，包含 lead slide、双栏表格、invert slide 和 checklist。

PlantUML smoke 图故意做得更复杂，方便肉眼确认是否真的重新渲染，而不是缓存了旧图。

`display.md` 则是更完整的插件展示文档，里面包含 58 个插件小节和对应演示内容。

## 验证记录

### 构建验证

```sh
cd /Users/cat/Documents/typora-plugin/typora_plugin/typora_plugin/develop
npm run build:macos
```

结果：

```text
macOS bundle written to .../plugin/macos/entry.bundle.js
```

### 自动测试

```sh
node --require ../plugin/global/core/polyfill.js --test \
  test/macos.test.js \
  test/diagram_parser.test.js \
  test/utils.test.js \
  test/window_tab.test.js
```

结果：

```text
tests 213
pass 213
fail 0
```

### PlantUML server 验证

复杂版 `test/diagram-smoke.md` 的 PlantUML block 通过 `localhost:8080` 请求验证：

```text
200 image/svg+xml 21049 bytes
```

### Typora GUI 验证

用 Computer Use 查看 Typora 实际界面和 accessibility tree：

- DrawIO：渲染后能看到 `Typora`、`Loader`、`Helper RPC`、`Plugins` 节点。
- PlantUML：渲染后能看到 `User`、`Typora`、`Loader`、`Helper` 的序列图，以及 `open markdown`、`load plugin`、`rpc health`、`ok` 等文本。
- Marp：渲染后能看到第一页 `Typora Plugin Display / macOS smoke sample`，第二页 `Checklist` 和 bullets。
- Marp 后续复杂版：Computer Use 看到四页内容已经渲染为 slide DOM，但旧窗口未重载 bundle 时仍会出现偏右；新 bundle 已同步到运行目录，需重载 Typora 后再做最终视觉复核。

这一步很重要，因为终端测试只能证明 bundle 和 server 没炸，不能证明 Typora WebKit 里真的画出来了。

## 当时的关键判断

### PlantUML 不合并 helper

这是这次修复里最重要的架构判断。

PlantUML 原版使用 PlantUML server 是合理的，`8080` 是常见习惯。如果为了 macOS helper 强行把它接进一个不固定端口的 RPC 服务，会带来几个问题：

- 和上游行为偏离，后续维护更难。
- PlantUML server 本身已经是成熟边界，不需要重复造一层。
- 用户已有的 Docker / Java PlantUML server 配置会变得不通用。
- helper 的职责会膨胀，变成“所有外部渲染器代理”。

最终保留 `localhost:8080`，只在 macOS bundle 里补 `zlib` 和 `Buffer`，是更干净的解法。

### 图表失败不是单纯的渲染问题

失败图表块会参与 Typora 的刷新生命周期。一个失败的 Marp 或 PlantUML 块，可能在用户编辑 Callouts 时被重新触发，从而造成“编辑下面却跳到上面”的错觉。

所以修复目标不只是“让图出来”，还包括：

- 失败时显示有用错误。
- 相同失败不反复刷新。
- lazy load 失败后允许恢复。
- 实际 Typora 界面里验证编辑体验。

## 后续注意

1. 如果 PlantUML 不显示，先确认 `localhost:8080` 是否有 PlantUML server。
2. 如果 DrawIO 再出现 `Type error`，优先检查 XML/source 是否有效，以及 GraphViewer sanitizer 是否被 patch。
3. 如果 Marp 再失败，优先检查 MathJax loader、Shadow DOM、图片路径、`marp-core` 初始化，以及内嵌 browser script 是否被 adapter 执行。
4. 如果 Marp 显示偏右或显示不全，不要优先改 `section` 百分比；先确认外层 SVG 缩放、Marp browser polyfill、`foreignObject > section` transform 是否生效。
5. macOS bundle 新增 Node shim 时，要同步补测试，避免重新把模块打成 unsupported。
6. 图表类插件修复后一定要在 Typora 里看，不要只靠命令行。

## 一句话纪念

这次修复真正越过的坎，不是某个图表语法，而是把三个重型渲染器从 Node/Electron 的习惯里拉回到 macOS WebKit 的现实里，并且让它们在 Typora 里真的画出来。
