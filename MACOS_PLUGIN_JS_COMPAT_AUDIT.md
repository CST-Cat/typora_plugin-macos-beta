# macOS 插件 JS 上游一致性检查

日期：2026-06-08

基准：GitHub 真上游 `obgnail/typora_plugin` 当前 `master`（`36913c3`，`https://github.com/obgnail/typora_plugin.git`）

复核方式：临时干净克隆 GitHub 真上游后逐文件比较，不以本地 `origin/master` 指针作为结论来源。

检查范围：

- 顺序按 `test/test.md` 的 58 个 `###` 标题。
- 每个标题下列出对应 fixedName 和入口 JS 文件。
- 单文件插件只比较该入口 JS。
- 目录型插件比较该插件目录下的 JS 文件。
- 不把 `plugin/macos/*`、bundle 产物、全局 core、CSS、settings 计入单个插件的“魔改”分类。

分类说明：

- `上游原版/未魔改`：插件 JS 与 GitHub 真上游一致；macOS 侧由全局 runtime、CommonJS registry、Node/browser shim、helper RPC 或原有本地资源直接承载。
- `上游原版 + bundle adapter`：插件 JS 与 GitHub 真上游一致；macOS 差异放在专属 adapter 或 virtual adapter。
- `上游原版 + bundle shim`：插件 JS 与 GitHub 真上游一致；macOS 差异由通用 bundle shim 补齐。
- `魔改（入口 JS）`：对应入口 JS 与 GitHub 真上游不一致。
- `魔改（辅助 JS）`：入口 JS 与 GitHub 真上游一致，但同插件目录下辅助 JS 与 GitHub 真上游不一致。

下面每个插件条目的 `移植方法` 只描述 macOS 侧如何承载该插件源码；`上游原版/未魔改` 不自动等于该功能已经完整人工回归。

汇总：

- 对照 GitHub 真上游共比较：58 个插件、109 个 JS 文件。
- 与真上游一致：109 个 JS 文件。
- 与真上游不一致：0 个 JS 文件。
- 上游原版/未魔改：47
- 上游原版 + bundle adapter：10
- 上游原版 + bundle shim：1
- 魔改（入口 JS）：0
- 魔改（辅助 JS）：0

迁移记录：

- 之前列为 `魔改（入口 JS）` 的 7 个插件入口已迁移回上游原版：`window_tab`、`markdownlint`、`commander`、`command_palette`、`image_viewer`、`sidebar_enhance`、`right_click_menu` 当前入口/插件目录 JS 均与 GitHub 真上游一致。
- macOS 差异改由 `plugin/macos/adapters/*`、bundle virtual adapter 或 bundle shim 承担。
- 最后一处 `preferences` 辅助 JS 差异也已迁移到 `plugin/macos/adapters/preferences.js`；`plugin/preferences/schemas.js` 当前与 GitHub 真上游一致。

## 真上游 PR 体量估算

估算基准：

- 真上游基准：`obgnail/typora_plugin@36913c3`
- 当前 macOS 分支：`macos-beta/master@1d4bfc3d`
- 估算命令：`git diff --numstat -z 36913c3449abbc75afdd50b395ea41083ff58f85..HEAD`

字面总量：

- 变化文件：86
- 文本文件：58
- 二进制资源：28
- 行数：`+166177 / -38`

体量拆分：

| 类别 | 文件数 | 文本文件 | 二进制文件 | 新增 | 删除 |
| --- | ---: | ---: | ---: | ---: | ---: |
| generated bundle | 1 | 1 | 0 | 157589 | 0 |
| macOS runtime source | 12 | 12 | 0 | 3623 | 0 |
| macOS build/tests | 9 | 9 | 0 | 1041 | 2 |
| core/plugin support tweaks | 14 | 14 | 0 | 200 | 36 |
| docs/scripts/audit | 8 | 8 | 0 | 1335 | 0 |
| test/demo docs and assets | 42 | 14 | 28 | 2389 | 0 |

结论：

- `plugin/macos/entry.bundle.js` 是生成产物，单文件占 `+157589` 行；如果带进真上游 PR，会让 PR 表面体量失真。
- 去掉生成 bundle 后，文本 diff 为 `+8588 / -38`。
- 如果再去掉展示文档、截图、纪念/审计文档，只保留 macOS runtime、helper、构建、测试和必要 core hook，预计是 `5k` 到 `6k` 行级别。
- 真正核心可 review 的 macOS 运行时代码约 `3.6k` 行；建议真上游 PR 不带生成 bundle，不带展示资产，并拆成多批提交。

如果真向上游拆 PR：

| 批次 | 内容 | 估算体量 | 备注 |
| --- | --- | ---: | --- |
| 1 | 必要 core hook / 平台探测 | `+200 / -36` 左右 | 最小侵入，先让上游接受 macOS 适配入口。 |
| 2 | `plugin/macos/*` 运行时与 adapters | `+3.6k` 左右 | 这是兼容层主体；插件源码仍保持上游原版。 |
| 3 | macOS 构建、安装、测试 | `+1k` 左右 | 包括 bundle/build/test/install 流程。 |
| 4 | 文档与审计记录 | 可选，`+1k` 到 `+2k` | 上游 PR 可精简，只保留用户安装说明和维护说明。 |

不建议带进真上游 PR 的内容：

- `plugin/macos/entry.bundle.js`：生成产物，应该由构建流程生成。
- `test/display.md`、截图、展示资源、纪念文档：适合留在 fork 或单独文档 PR，不适合塞进核心适配 PR。
- 插件源码 JS 的 macOS 专属修改：当前 109 个插件 JS 已经与 GitHub 真上游一致，后续也应继续放到 adapters/shims。

## 01. 标签页管理

- fixedName：`window_tab`
- JS 文件：`plugin/window_tab.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：源码保持 GitHub 真上游原版；macOS registry 将 `window_tab` 指向 `plugin/macos/adapters/window_tab.js`，adapter 继承上游实现并补 TypeMark 顶栏布局、切换前滚动记录、切换后恢复、文件存在检查跳过和拖拽反馈。

## 02. 格式检查

- fixedName：`markdownlint`
- JS 文件：`plugin/markdownlint/index.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：插件目录 JS 保持 GitHub 真上游原版；macOS registry 将 `markdownlint` 指向 `plugin/macos/adapters/markdownlint.js`，adapter 处理 WebKit 下 worker/CommonJS、当前内容读取 fallback、lint 面板定位和修复入口。

## 03. 右侧大纲

- fixedName：`right_outline`
- JS 文件：`plugin/right_outline.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；由 macOS bundle 直接注册运行，依赖全局 WebKit runtime 提供的 DOM、滚动和标题树事件，不需要专属 adapter。

## 04. 多元文字搜索

- fixedName：`search_multi`
- JS 文件：`plugin/search_multi/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；搜索器、解析器和高亮器直接打进 bundle，文件遍历/读取通过全局 `walkDir`、`fs-extra` shim 和 helper RPC 承接。

## 05. 只读模式

- fixedName：`read_only`
- JS 文件：`plugin/read_only.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；直接使用 Typora/TypeMark 编辑区事件和 core utils 拦截输入、粘贴、任务项点击，不需要专属 adapter。

## 06. 夜间模式

- fixedName：`dark`
- JS 文件：`plugin/dark.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；主题/CSS 注入由全局 styleManager 和 WebKit DOM 直接承载，不需要专属 adapter。

## 07. 无图模式

- fixedName：`no_image`
- JS 文件：`plugin/no_image.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；图片显示隐藏走 DOM/CSS 和 core 工具方法，macOS 无额外源码改动。

## 08. 模糊模式

- fixedName：`blur`
- JS 文件：`plugin/blur.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；聚焦/模糊效果走 WebKit DOM、鼠标/光标事件和 CSS 注入，当前不需要专属 adapter。

## 09. 命令行环境

- fixedName：`commander`
- JS 文件：`plugin/commander.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：源码保持 GitHub 真上游原版；macOS registry 将 `commander` 指向 `plugin/macos/adapters/commander.js`，adapter 注入 Zsh/Bash 策略、macOS Terminal 预设、粘贴换行处理，并通过 helper-backed `child_process` shim 执行命令。配置 schema 的 `zsh` 默认值差异记录在第 37 项。

## 10. 命令面板

- fixedName：`command_palette`
- JS 文件：`plugin/command_palette.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：源码保持 GitHub 真上游原版；macOS registry 将 `command_palette` 指向 `plugin/macos/adapters/command_palette.js`，adapter 提供本地 i18n fallback、标签页/最近文件/插件动作 provider、超时保护和 macOS 常用命令执行。

## 11. 中英文混排优化

- fixedName：`md_padding`
- JS 文件：`plugin/md_padding/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；`md-padding` 本地库随 bundle 加载，选区读取和正文改写走全局编辑器/core API，不需要专属 adapter。

## 12. 标记常显

- fixedName：`static_markers`
- JS 文件：`plugin/static_markers.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；Markdown 标记显示逻辑直接作用于编辑区 DOM/CSS 和 Typora 渲染节点，不需要专属 adapter。

## 13. 离焦视力舒缓

- fixedName：`myopic_defocus`
- JS 文件：`plugin/myopic_defocus.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；离焦弱化效果由 DOM 范围计算、滚动/光标事件和 CSS 注入承载，不需要专属 adapter。

## 14. 图片放缩

- fixedName：`resize_image`
- JS 文件：`plugin/resize_image.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；图片选中、拖拽和宽高写回走 Typora 渲染 DOM 与 core 文件编辑工具，不需要专属 adapter。

## 15. 表格放缩

- fixedName：`resize_table`
- JS 文件：`plugin/resize_table.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；表格列宽拖拽和样式写回直接使用 WebKit 表格 DOM、鼠标事件和 core 编辑工具，不需要专属 adapter。

## 16. DataTables

- fixedName：`datatables`
- JS 文件：`plugin/datatables/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；DataTables 本地 JS/CSS 资源按插件路径加载，表格增强直接作用于 Typora 渲染表格，不需要专属 adapter。

## 17. Markmap

- fixedName：`markmap`
- JS 文件：`plugin/markmap/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；markmap、webfontloader 和本地化资源随 bundle/插件目录加载，TOC/fence 渲染走原插件逻辑和全局 diagram/parser 能力，不改插件源码。

## 18. 自动编号

- fixedName：`auto_number`
- JS 文件：`plugin/auto_number.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；标题、表格、图片、代码块编号通过 DOM 扫描和 CSS 注入实现，macOS 侧仅依赖全局 runtime。

## 19. 代码块增强

- fixedName：`fence_enhance`
- JS 文件：`plugin/fence_enhance/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；代码块复制、折叠、缩进等动作直接接入 Typora fence DOM，相关资源模块由 macOS bundle registry 注册，不需要专属 adapter。

## 20. 章节折叠

- fixedName：`collapse_paragraph`
- JS 文件：`plugin/collapse_paragraph.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；章节层级和折叠状态直接根据标题 DOM 与编辑区事件维护，不需要专属 adapter。

## 21. 列表折叠

- fixedName：`collapse_list`
- JS 文件：`plugin/collapse_list.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；列表折叠控制直接作用于 Typora 列表 DOM、鼠标事件和 CSS 类，不需要专属 adapter。

## 22. 表格折叠

- fixedName：`collapse_table`
- JS 文件：`plugin/collapse_table.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；表格折叠按钮和显隐状态直接作用于渲染表格 DOM，不需要专属 adapter。

## 23. 图片查看

- fixedName：`image_viewer`
- JS 文件：`plugin/image_viewer.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：源码保持 GitHub 真上游原版；macOS registry 将 `image_viewer` 指向 `plugin/macos/adapters/image_viewer.js`，adapter 处理本地相对路径转 `file://`、Markdown 图片引用扫描、modal 层定位、标题栏避让和事件兼容。

## 24. 文段截断

- fixedName：`truncate_text`
- JS 文件：`plugin/truncate_text.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；文段长度检测、折叠按钮和展开状态直接作用于正文 DOM，不需要专属 adapter。

## 25. 导出增强

- fixedName：`export_enhance`
- JS 文件：`plugin/export_enhance.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；导出 hook 仍接入 core `exportHelper`，图片读写通过 `fs-extra` shim/helper RPC，网络图片下载通过全局 fetch 工具承接，不需要专属 adapter。

## 26. 侧边栏增强

- fixedName：`sidebar_enhance`
- JS 文件：`plugin/sidebar_enhance.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：源码保持 GitHub 真上游原版；macOS registry 将 `sidebar_enhance` 指向 `plugin/macos/adapters/sidebar_enhance.js`，adapter 处理 TypeMark 侧边栏 DOM 差异、文件计数 badge 布局和目录遍历错误处理。

## 27. 文字风格化

- fixedName：`text_stylize`
- JS 文件：`plugin/text_stylize.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；样式对话框、选区格式化和 inline style 写回使用全局编辑器/core API，当前不需要专属 adapter。

## 28. 加密文件

- fixedName：`cipher`
- JS 文件：`plugin/cipher/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；AES 本地库随 bundle 加载，文件内容替换通过 core `editCurrentFile` 完成，不需要专属 adapter。

## 29. 编辑工具

- fixedName：`easy_modify`
- JS 文件：`plugin/easy_modify.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；路径复制、标题路径、时间插入和大小写转换等动作直接使用 core utils、剪贴板/编辑器能力，不需要专属 adapter。

## 30. 二级插件

- fixedName：`custom`
- JS 文件：`plugin/custom/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；二级插件入口仍按上游注册，macOS runtime 通过 helper RPC 读取 custom plugin 并注册到 CommonJS registry，插件入口本身不需要专属 adapter。

## 31. 悬浮动作按钮

- fixedName：`action_buttons`
- JS 文件：`plugin/action_buttons.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；悬浮按钮的插入、定位和点击动作直接由 WebKit DOM 与全局 core 承载，不需要专属 adapter。

## 32. 鼠标手势

- fixedName：`mouse_gestures`
- JS 文件：`plugin/mouse_gestures.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；鼠标轨迹、手势识别和动作分发走 WebKit pointer/mouse 事件与 core utils，不需要专属 adapter。

## 33. 斜杠命令

- fixedName：`slash_commands`
- JS 文件：`plugin/slash_commands.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；输入监听、候选菜单和插入动作直接接入 Typora 编辑区事件，不需要专属 adapter。

## 34. 中文符号配对

- fixedName：`cjk_symbol_pairing`
- JS 文件：`plugin/cjk_symbol_pairing.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；中文符号配对通过键盘/input 事件和 core 插入文本能力完成，不需要专属 adapter。

## 35. 右键菜单

- fixedName：`right_click_menu`
- JS 文件：`plugin/right_click_menu.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：源码保持 GitHub 真上游原版；macOS registry 将 `right_click_menu` 指向 `plugin/macos/adapters/right_click_menu.js`，adapter 负责把插件一级菜单注入 TypeMark/macOS 原生右键菜单，并复用上游二级/三级菜单逻辑。

## 36. 圆盘菜单

- fixedName：`pie_menu`
- JS 文件：`plugin/pie_menu.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；圆盘菜单渲染、鼠标事件和动作分发直接依赖 WebKit DOM/canvas 与 core utils，不需要专属 adapter。

## 37. 插件配置

- fixedName：`preferences`
- JS 文件：`plugin/preferences/index.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：插件目录 JS 保持 GitHub 真上游原版；macOS registry 将 `preferences` 指向 `plugin/macos/adapters/preferences.js`，adapter 在运行时给 commander schema/i18n 增补 `zsh` 选项和默认值，不改 `plugin/preferences/schemas.js`。

## 38. 快捷键中心

- fixedName：`hotkeys`
- JS 文件：`plugin/hotkeys.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；热键收集和冲突展示直接读取已注册插件 action/hotkey 信息，macOS 侧依赖全局 registry，不需要专属 adapter。

## 39. 资源管理

- fixedName：`resource_manager`
- JS 文件：`plugin/resource_manager.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；资源扫描通过 `walkDir`、`fs-extra` shim 和 helper RPC 访问文件系统，保存报告仍走 `JSBridge.invoke("dialog.showSaveDialog")`，当前不需要专属 adapter。

## 40. 资源重定向

- fixedName：`asset_root_redirect`
- JS 文件：`plugin/asset_root_redirect.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；资源根目录重定向仍通过上游路径解析 hook 和 core utils 完成，macOS 侧由 path/url shim 承接，不需要专属 adapter。

## 41. 书签管理

- fixedName：`bookmark`
- JS 文件：`plugin/bookmark.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；书签记录、面板和跳转直接使用编辑区 DOM、文件路径和 core 持久化能力，不需要专属 adapter。

## 42. 文件模板

- fixedName：`templater`
- JS 文件：`plugin/templater.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；模板目录遍历、模板读取和新文件写入通过 `fs-extra` shim/helper RPC 与 core 文件 API 完成，不需要专属 adapter。

## 43. 写作区宽度调整

- fixedName：`editor_width_slider`
- JS 文件：`plugin/editor_width_slider.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；写作区宽度调整通过 CSS 变量/DOM 样式直接作用于 TypeMark 编辑区，不需要专属 adapter。

## 44. 文章上传

- fixedName：`article_uploader`
- JS 文件：`plugin/article_uploader/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；当前只是随 macOS bundle 注册，上传链路仍依赖 `https`、`selenium-webdriver`、`chromedriver`、`node-notifier` 等 Node/外部浏览器自动化能力，尚未迁到 helper/adapter，属于后续专配项。

## 45. Ripgrep

- fixedName：`ripgrep`
- JS 文件：`plugin/ripgrep.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；`shared-shims.js` 将 `vscode-ripgrep` 映射为 `__TP_MACOS_RG__`，并用 helper-backed `child_process.spawn` 执行 rg，因此不需要插件专属 adapter。

## 46. 光标历史

- fixedName：`cursor_history`
- JS 文件：`plugin/cursor_history.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；光标位置记录和前进/后退跳转直接使用编辑区 selection/range 与 core eventHub，不需要专属 adapter。

## 47. 远程控制

- fixedName：`remote_control`
- JS 文件：`plugin/remote_control/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；当前只是随 macOS bundle 注册，但上游 RPC server 依赖 Node `http`，WebKit bundle 没有专属 `remote_control` adapter，若要在 macOS 完整启用应迁到 helper 侧或新增 adapter。

## 48. 升级插件

- fixedName：`updater`
- JS 文件：`plugin/updater.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；版本检查可走全局 fetch，文件同步依赖 `fs-extra`/`child_process` helper shims；自更新涉及解压、chmod、move/emptyDir 等更完整文件操作，当前未做专属 adapter，完整链路仍需单独验证/补齐。

## 49. Timeline

- fixedName：`timeline`
- JS 文件：`plugin/timeline.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；时间线渲染由第三方 diagram parser 和 WebKit DOM/CSS 直接承载，不需要专属 adapter。

## 50. ECharts

- fixedName：`echarts`
- JS 文件：`plugin/echarts/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；`echarts.min.js` 作为本地资源随 bundle 加载，图表创建/更新走上游 diagram parser 注册，不需要专属 adapter。

## 51. Chart

- fixedName：`chart`
- JS 文件：`plugin/chart/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；`chart.min.js` 作为本地资源随 bundle 加载，canvas 图表渲染直接运行在 WebKit，不需要专属 adapter。

## 52. WaveDrom

- fixedName：`wavedrom`
- JS 文件：`plugin/wavedrom/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；WaveDrom 主库和 skin 文件作为本地资源由 bundle registry 加载，SVG 渲染走 WebKit DOM，不需要专属 adapter。

## 53. Calendar

- fixedName：`calendar`
- JS 文件：`plugin/calendar/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；TOAST UI Calendar 本地资源随插件目录加载，日历 DOM/CSS 直接运行在 WebKit，不需要专属 adapter。

## 54. ABC

- fixedName：`abc`
- JS 文件：`plugin/abc/index.js`
- 分类：`上游原版/未魔改`
- 移植方法：插件目录 JS 保持真上游；`abcjs-basic-min.js` 作为本地资源由 bundle 加载，ABC 乐谱文本直接渲染为 SVG/DOM，不需要专属 adapter。

## 55. DrawIO

- fixedName：`drawIO`
- JS 文件：`plugin/drawIO.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：源码保持 GitHub 真上游原版；macOS build 用 virtual module `macos-drawio-adapter` 包装上游插件，修补 GraphViewer 加载、DOMPurify fallback、`data-mxgraph` 渲染流程和 `Type error` 检测，不改 `plugin/drawIO.js`。

## 56. PlantUML

- fixedName：`plantUML`
- JS 文件：`plugin/plantUML.js`
- 分类：`上游原版 + bundle shim`
- 移植方法：源码保持 GitHub 真上游原版；PlantUML 仍按上游方式使用 `zlib.deflateRawSync` 编码并请求 PlantUML server，macOS build 提供 `macos-zlib`、`Buffer` 和 fetch shim，不改 `plugin/plantUML.js`。

## 57. Marp

- fixedName：`marp`
- JS 文件：`plugin/marp/index.js`
- 分类：`上游原版 + bundle adapter`
- 移植方法：插件目录 JS 保持 GitHub 真上游原版；macOS build 用 virtual module `macos-marp-adapter` 包装上游插件，补 Shadow DOM 中 Marp SVG 响应式缩放、宽度约束、嵌入脚本执行和图片路径兼容，不改 `plugin/marp/index.js`。

## 58. Callouts

- fixedName：`callouts`
- JS 文件：`plugin/callouts.js`
- 分类：`上游原版/未魔改`
- 移植方法：源码保持真上游；callout 识别和样式转换直接作用于引用块 DOM/CSS，macOS 侧由全局 runtime 承载，不需要专属 adapter。
