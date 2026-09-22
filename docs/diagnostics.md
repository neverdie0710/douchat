# 本地显示异常日志

点击设置时自动记录打开请求、组件挂载和布局尺寸。5 秒内没有布局反馈会记录 `settings.render-timeout`。同时记录 React 渲染错误和组件堆栈、未捕获的 JavaScript 错误、未处理的 Promise 拒绝、preload/页面加载失败、窗口无响应、渲染/GPU 等子进程退出，以及启动时的应用、Electron、Chromium 和操作系统版本。

用户复现问题后，可在“设置 → 关于 → 打开日志目录”获取日志。设置打不开时，在应用窗口按 **Ctrl+Shift+L**（macOS 为 Cmd+Shift+L）。窗口完全无响应时，可通过资源管理器直接打开：

- Windows 正式版：`%APPDATA%\douchat\logs`
- macOS 正式版：`~/Library/Application Support/douchat/logs`
- 开发版的数据目录名为 `douchat-dev`。

把 `diagnostics.log` 和存在时的 `diagnostics.log.1` 一起发送给开发者，并说明复现时间、操作和截图。日志仅保存在本地，不自动上传。单文件上限约 2 MiB，最多保留当前文件和一份轮换备份。

日志不主动收集聊天内容、账户资料、配置或截图；错误文本中的常见凭据和 URL 参数会脱敏，但任意第三方异常文本仍可能包含其他私人信息，分享前可检查文件。日志写入失败不会阻止应用运行。

`settings.layout` 只证明 DOM 完成布局，不能证明 GPU 已正确显示像素。白屏可能没有 JavaScript 异常；需结合版本、进程事件和用户截图分析。快捷键依赖窗口仍能接收键盘事件，完全卡死时使用上述目录路径。
