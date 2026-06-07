# macOS 插件 JS 上游一致性检查

日期：2026-06-07

基准：`origin/master`（`https://github.com/obgnail/typora_plugin.git`）

检查范围：

- 顺序按 `test/test.md` 的 58 个 `###` 标题。
- 每个标题下列出对应 fixedName 和入口 JS 文件。
- 单文件插件只比较该入口 JS。
- 目录型插件比较该插件目录下的 JS 文件。
- 不把 `plugin/macos/*`、bundle 产物、全局 core、CSS、settings 计入单个插件的“魔改”分类。

分类说明：

- `上游原版/未魔改`：插件 JS 与 `origin/master` 一致，未发现专属 bundle adapter。
- `上游原版 + bundle adapter`：插件 JS 与 `origin/master` 一致，macOS 差异放在 bundle adapter。
- `上游原版 + bundle shim`：插件 JS 与 `origin/master` 一致，macOS 差异由 bundle shim 补齐。
- `魔改（入口 JS）`：对应入口 JS 与 `origin/master` 不一致。
- `魔改（辅助 JS）`：入口 JS 与上游一致，但同插件目录下辅助 JS 与上游不一致。

汇总：

- 上游原版/未魔改：47
- 上游原版 + bundle adapter：2
- 上游原版 + bundle shim：1
- 魔改（入口 JS）：7
- 魔改（辅助 JS）：1

## 01. 标签页管理

- fixedName：`window_tab`
- JS 文件：`plugin/window_tab.js`
- 分类：`魔改（入口 JS）`
- 说明：入口 JS 与上游不一致。
- 变更 JS：`plugin/window_tab.js`

## 02. 格式检查

- fixedName：`markdownlint`
- JS 文件：`plugin/markdownlint/index.js`
- 分类：`魔改（入口 JS）`
- 说明：入口 JS 与上游不一致。
- 变更 JS：`plugin/markdownlint/index.js`、`plugin/markdownlint/linter-worker.js`

## 03. 右侧大纲

- fixedName：`right_outline`
- JS 文件：`plugin/right_outline.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 04. 多元文字搜索

- fixedName：`search_multi`
- JS 文件：`plugin/search_multi/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 05. 只读模式

- fixedName：`read_only`
- JS 文件：`plugin/read_only.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 06. 夜间模式

- fixedName：`dark`
- JS 文件：`plugin/dark.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 07. 无图模式

- fixedName：`no_image`
- JS 文件：`plugin/no_image.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 08. 模糊模式

- fixedName：`blur`
- JS 文件：`plugin/blur.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 09. 命令行环境

- fixedName：`commander`
- JS 文件：`plugin/commander.js`
- 分类：`魔改（入口 JS）`
- 说明：入口 JS 与上游不一致。
- 变更 JS：`plugin/commander.js`

## 10. 命令面板

- fixedName：`command_palette`
- JS 文件：`plugin/command_palette.js`
- 分类：`魔改（入口 JS）`
- 说明：入口 JS 与上游不一致。
- 变更 JS：`plugin/command_palette.js`

## 11. 中英文混排优化

- fixedName：`md_padding`
- JS 文件：`plugin/md_padding/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 12. 标记常显

- fixedName：`static_markers`
- JS 文件：`plugin/static_markers.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 13. 离焦视力舒缓

- fixedName：`myopic_defocus`
- JS 文件：`plugin/myopic_defocus.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 14. 图片放缩

- fixedName：`resize_image`
- JS 文件：`plugin/resize_image.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 15. 表格放缩

- fixedName：`resize_table`
- JS 文件：`plugin/resize_table.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 16. DataTables

- fixedName：`datatables`
- JS 文件：`plugin/datatables/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 17. Markmap

- fixedName：`markmap`
- JS 文件：`plugin/markmap/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 18. 自动编号

- fixedName：`auto_number`
- JS 文件：`plugin/auto_number.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 19. 代码块增强

- fixedName：`fence_enhance`
- JS 文件：`plugin/fence_enhance/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 20. 章节折叠

- fixedName：`collapse_paragraph`
- JS 文件：`plugin/collapse_paragraph.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 21. 列表折叠

- fixedName：`collapse_list`
- JS 文件：`plugin/collapse_list.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 22. 表格折叠

- fixedName：`collapse_table`
- JS 文件：`plugin/collapse_table.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 23. 图片查看

- fixedName：`image_viewer`
- JS 文件：`plugin/image_viewer.js`
- 分类：`魔改（入口 JS）`
- 说明：入口 JS 与上游不一致。
- 变更 JS：`plugin/image_viewer.js`

## 24. 文段截断

- fixedName：`truncate_text`
- JS 文件：`plugin/truncate_text.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 25. 导出增强

- fixedName：`export_enhance`
- JS 文件：`plugin/export_enhance.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 26. 侧边栏增强

- fixedName：`sidebar_enhance`
- JS 文件：`plugin/sidebar_enhance.js`
- 分类：`魔改（入口 JS）`
- 说明：入口 JS 与上游不一致。
- 变更 JS：`plugin/sidebar_enhance.js`

## 27. 文字风格化

- fixedName：`text_stylize`
- JS 文件：`plugin/text_stylize.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 28. 加密文件

- fixedName：`cipher`
- JS 文件：`plugin/cipher/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 29. 编辑工具

- fixedName：`easy_modify`
- JS 文件：`plugin/easy_modify.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 30. 二级插件

- fixedName：`custom`
- JS 文件：`plugin/custom/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 31. 悬浮动作按钮

- fixedName：`action_buttons`
- JS 文件：`plugin/action_buttons.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 32. 鼠标手势

- fixedName：`mouse_gestures`
- JS 文件：`plugin/mouse_gestures.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 33. 斜杠命令

- fixedName：`slash_commands`
- JS 文件：`plugin/slash_commands.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 34. 中文符号配对

- fixedName：`cjk_symbol_pairing`
- JS 文件：`plugin/cjk_symbol_pairing.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 35. 右键菜单

- fixedName：`right_click_menu`
- JS 文件：`plugin/right_click_menu.js`
- 分类：`魔改（入口 JS）`
- 说明：入口 JS 与上游不一致。
- 变更 JS：`plugin/right_click_menu.js`

## 36. 圆盘菜单

- fixedName：`pie_menu`
- JS 文件：`plugin/pie_menu.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 37. 插件配置

- fixedName：`preferences`
- JS 文件：`plugin/preferences/index.js`
- 分类：`魔改（辅助 JS）`
- 说明：入口 JS 与上游一致，但同插件目录有辅助 JS 变更。
- 变更 JS：`plugin/preferences/schemas.js`

## 38. 快捷键中心

- fixedName：`hotkeys`
- JS 文件：`plugin/hotkeys.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 39. 资源管理

- fixedName：`resource_manager`
- JS 文件：`plugin/resource_manager.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 40. 资源重定向

- fixedName：`asset_root_redirect`
- JS 文件：`plugin/asset_root_redirect.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 41. 书签管理

- fixedName：`bookmark`
- JS 文件：`plugin/bookmark.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 42. 文件模板

- fixedName：`templater`
- JS 文件：`plugin/templater.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 43. 写作区宽度调整

- fixedName：`editor_width_slider`
- JS 文件：`plugin/editor_width_slider.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 44. 文章上传

- fixedName：`article_uploader`
- JS 文件：`plugin/article_uploader/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 45. Ripgrep

- fixedName：`ripgrep`
- JS 文件：`plugin/ripgrep.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 46. 光标历史

- fixedName：`cursor_history`
- JS 文件：`plugin/cursor_history.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 47. 远程控制

- fixedName：`remote_control`
- JS 文件：`plugin/remote_control/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 48. 升级插件

- fixedName：`updater`
- JS 文件：`plugin/updater.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 49. Timeline

- fixedName：`timeline`
- JS 文件：`plugin/timeline.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 50. ECharts

- fixedName：`echarts`
- JS 文件：`plugin/echarts/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 51. Chart

- fixedName：`chart`
- JS 文件：`plugin/chart/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 52. WaveDrom

- fixedName：`wavedrom`
- JS 文件：`plugin/wavedrom/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 53. Calendar

- fixedName：`calendar`
- JS 文件：`plugin/calendar/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 54. ABC

- fixedName：`abc`
- JS 文件：`plugin/abc/index.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。

## 55. DrawIO

- fixedName：`drawIO`
- JS 文件：`plugin/drawIO.js`
- 分类：`上游原版 + bundle adapter`
- 说明：入口/插件 JS 与上游一致；macOS 兼容由 `macos-drawio-adapter` 承担。

## 56. PlantUML

- fixedName：`plantUML`
- JS 文件：`plugin/plantUML.js`
- 分类：`上游原版 + bundle shim`
- 说明：入口/插件 JS 与上游一致；macOS 兼容由 `zlib` / `Buffer` bundle shim 承担。

## 57. Marp

- fixedName：`marp`
- JS 文件：`plugin/marp/index.js`
- 分类：`上游原版 + bundle adapter`
- 说明：入口/插件 JS 与上游一致；macOS 兼容由 `macos-marp-adapter` 承担。

## 58. Callouts

- fixedName：`callouts`
- JS 文件：`plugin/callouts.js`
- 分类：`上游原版/未魔改`
- 说明：入口/插件 JS 与上游一致；未发现专属 bundle adapter。
