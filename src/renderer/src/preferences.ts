import { useSyncExternalStore } from 'react'

export type Preferences = { language: 'en' | 'zh-CN'; appearance: 'system' | 'light' | 'dark'; fontSize: number }
const key = 'douchat.general'
function read(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}')
    return { language: saved.language === 'zh-CN' ? 'zh-CN' : 'en', appearance: ['light', 'dark'].includes(saved.appearance) ? saved.appearance : 'system', fontSize: Number.isInteger(saved.fontSize) && saved.fontSize >= 0 && saved.fontSize <= 4 ? saved.fontSize : 1 }
  } catch { return { language: 'en', appearance: 'system', fontSize: 1 } }
}
let current = read()
const listeners = new Set<() => void>()
const media = matchMedia('(prefers-color-scheme: dark)')
function apply(): void {
  document.documentElement.dataset.theme = current.appearance === 'system' ? (media.matches ? 'dark' : 'light') : current.appearance
  document.documentElement.lang = current.language
  document.documentElement.style.setProperty('--font-scale', String([0.85, 0.92, 1, 1.1, 1.2][current.fontSize]))
}
export function setPreferences(patch: Partial<Preferences>): void {
  current = { ...current, ...patch }
  localStorage.setItem(key, JSON.stringify(current))
  apply()
  listeners.forEach((notify) => notify())
}
window.addEventListener('storage', (event) => {
  if (event.key !== key) return
  current = read(); apply(); listeners.forEach((notify) => notify())
})
media.addEventListener('change', apply)
apply()
export function usePreferences(): Preferences {
  return useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify) } }, () => current)
}
export function t(text: string): string {
  if (current.language !== 'zh-CN') return text
  const exact = translations[text]
  if (exact) return exact

  const patterns: Array<[RegExp, (...matches: string[]) => string]> = [
    [/^(.+) could not deliver a message to another bot\.?$/, (_all, name) => `${name} 无法向其他智能体传递消息。`],
    [/^(.+) has no model to answer with\.?(?: (.*))?$/, (_all, name, detail) => `${name} 没有可用于回复的模型。${detail ?? ''}`],
    [/^(.+) finished without a text response\.?$/, (_all, name) => `${name} 未返回文字内容。`],
    [/^(?:429:\s*)?.*Douchat credit balance is insufficient.*$/i, () => 'Douchat 点数不足，暂时无法完成此请求。'],
    [/^Model (.+) is not available$/, (_all, model) => `模型 ${model} 当前不可用`],
    [/^Login service returned (\d+)\. Try again\.$/, (_all, status) => `登录服务返回 ${status}，请重试。`],
    [/^The gateway rejected the model list \((\d+)\)$/, (_all, status) => `模型服务拒绝了模型列表请求（${status}）`]
  ]
  for (const [pattern, replace] of patterns) {
    const match = pattern.exec(text)
    if (match) return replace(...match)
  }

  const prefixes: Array<[string, string]> = [
    ['The model endpoint rejected the request', '模型服务拒绝了请求'],
    ['The model endpoint was not found', '未找到模型服务'],
    ['The model endpoint timed out', '模型服务请求超时'],
    ['The provider is rate limiting this key', '模型服务对当前密钥进行了限流'],
    ['The provider returned a server error', '模型服务返回服务器错误'],
    ['Could not reach the model endpoint', '无法连接模型服务'],
    ['Lost the connection to the model endpoint', '与模型服务的连接已中断'],
    ['The conversation could not finish', '对话未能完成']
  ]
  const prefix = prefixes.find(([source]) => text.startsWith(source))
  return prefix ? `${prefix[1]}${text.slice(prefix[0].length)}` : text
}
export function tr(text: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    t(text)
  )
}
const translations: Record<string, string> = {
  'Dr. Dou': '豆博士', 'Douchat assistant': 'Douchat 云端助手',
  'Could not reach the login service. Check your connection and try again.': '无法连接登录服务，请检查网络后重试。', 'This login request has expired. Start again.': '本次登录请求已过期，请重新开始。', 'The login request expired or was already used. Start again.': '本次登录请求已过期或已经使用，请重新开始。', 'Authorization code is invalid, expired, or already used': '授权码无效、已过期或已经使用，请重新开始。', 'Login callback could not be verified': '无法验证登录回调，请重新开始。', 'Login callback did not include a valid authorization code': '登录回调中没有有效的授权码。', 'Login service returned an invalid session.': '登录服务返回了无效会话。', 'Login service returned an invalid user.': '登录服务返回了无效用户信息。', 'Secure credential storage is unavailable on this computer.': '此电脑无法使用安全凭证存储。', 'Douchat Cloud Chat is not enabled or its upstream model is not configured.': 'Douchat Cloud Chat 尚未启用，或上游模型尚未配置。',
  'Meet Douchat': '遇见 Douchat', 'Your smartest collaboration partner.': '你最聪明的协作伙伴。', 'Continue in browser': '在浏览器中继续', 'Open login page again': '重新打开登录页', 'Secure browser login': '安全的浏览器登录', 'Waiting for browser login…': '正在等待浏览器登录…', 'Finish signing in in your browser. Douchat will return automatically.': '请在浏览器中完成登录，成功后将自动返回 Douchat。', 'Your password stays in the browser. Douchat only receives a one-time authorization code.': '密码始终保留在浏览器中，Douchat 只接收一次性授权码。', 'Login could not be completed': '登录未完成', 'Encrypted session storage on this device': '登录凭证已在此设备上加密保存', 'Checking your login…': '正在检查登录状态…',
  'Search group members': '搜索群成员', 'Remove group members': '移出群成员', 'Select members to remove': '从左侧选择要移出的群成员', 'Keep at least one member': '群聊至少保留一位成员',
  'Group members': '群聊成员', 'Create group': '创建群聊', 'Add group members': '添加群成员', 'Already added': '已加入', 'Selected agents': '已选智能体', 'Selected': '已选择', 'Select agents to add': '从左侧选择要添加的智能体', 'No matching agents': '没有匹配的智能体',
  'Existing groups': '已有群聊', 'Open group': '进入群聊', 'Open chat': '进入聊天', 'No matching groups': '没有匹配的群聊', 'Select one agent to chat, several to create a group, or open an existing group.': '选择一个智能体开始聊天，选择多个智能体创建群聊，或直接进入已有群聊。',
  'Agent': '智能体', 'Edit agent': '编辑智能体', 'Agent menu': '智能体菜单', 'Delete agent': '删除智能体', 'Avatar': '头像', 'Nickname': '昵称', 'Description': '描述', 'Add a description': '添加更多描述信息', 'Search or create labels': '搜索或创建标签…', 'Done': '完成', 'This picture could not be used.': '无法使用这张图片。', 'Role': '角色', 'Agent details': '智能体资料', 'Instructions': '行为指令', 'Labels': '标签', 'More information': '更多信息', 'Shared groups': '共同群聊', 'Source': '来源', 'Cloud model': '云端模型', 'Local proxy': '本地代理', 'Model endpoint': '模型服务', 'Added on': '添加时间',
  'Typing': '正在输入', 'Coordinating the group': '正在协调群聊', 'Preparing a greeting': '正在准备问候', 'Delivering a message': '正在传递消息', 'Preparing a reply': '正在回复',
  'Search chat history': '查找聊天内容', 'Clear chat history': '清空聊天记录', 'Clear all messages in this chat? This cannot be undone.': '确定清空当前聊天记录？此操作无法撤销。', 'No matching messages': '暂无匹配消息', 'Showing latest 100 matches': '显示最近 100 条匹配消息', 'Could not load messages': '加载消息失败，请重试', 'Could not save changes': '保存失败，请重试',
  'Loading…': '加载中…', 'Load earlier messages': '加载更早的消息', 'Retry loading earlier messages': '加载失败，点击重试',
'Pin to top': '置顶',
'Unpin': '取消置顶',
'Mark as unread': '标为未读',
'Mark as read': '标为已读',
'Mute notifications': '消息免打扰',
'Unmute notifications': '取消免打扰',
'Open in separate window': '独立窗口显示',
'Hide chat': '不显示',
  'No conversation selected': '未选择对话',
  'Start chat': '发起聊天', 'No chats yet': '暂无聊天',
  'Create agent': '创建智能体', 'Agent name': '智能体名称', 'Enter agent name': '输入智能体名称', 'Runs with': '运行方式', 'Use cloud model': '使用云端模型', 'Use local proxy': '基于本地代理', 'Douchat cloud model': 'Douchat 云端模型', 'AI tools on this computer': '本机 AI 工具', 'Select a local proxy': '选择本地代理', 'No available local proxies': '暂无可用的本地代理', 'Douchat Cloud': 'Douchat 云端', 'Saving…': '保存中…', 'Close': '关闭',
  'Settings': '设置', 'Profile': '个人资料', 'Account': '账号', 'General': '通用', 'Agents': '智能体', 'Models': '模型', 'About': '关于', 'Update available': '有可用更新',
  'Connectors': '连接器', 'Connect accounts and let selected agents use their data and actions.': '连接外部账户，并让指定智能体使用其中的数据和操作。',
  'Connected accounts': '已连接账户', '{count} agents enabled': '已授权 {count} 个智能体', 'No agents enabled': '未授权智能体', 'Connected': '已连接',
  'Available connectors': '可用连接器', 'Built in': '内置', 'Connect': '连接',
  'Search, read, and summarize mail through IMAP. SMTP is verified for future sending support.': '通过 IMAP 搜索、阅读和总结邮件；同时验证 SMTP，为后续发送能力做好准备。',
  'Credentials stay encrypted on this computer': '凭据仅在本机加密保存',
  'Connectors are managed here because they belong to your account. Each agent still needs separate access.': '连接器属于你的账户，因此统一在这里管理；每个智能体仍需单独授权。',
  'Work email': '工作邮箱', 'Manage email': '管理邮箱', 'Connect email': '连接邮箱', 'Test both incoming and outgoing servers before saving.': '保存前会同时验证收件和发件服务器。',
  'Back to connectors': '返回连接器', 'Mailbox': '邮箱账户', 'This name and address identify the account to your agents.': '智能体将通过这个名称和地址识别邮箱。',
  'Account name': '账户名称', 'Email address': '邮箱地址', 'Provider': '服务商', 'Username': '用户名', 'Password or authorization code': '密码或授权码',
  'Feishu Mail': '飞书邮箱', 'Other IMAP/SMTP': '其他 IMAP/SMTP', 'Leave blank to keep the saved credential': '留空以保留已保存的凭据', 'Enter authorization code': '输入邮箱授权码',
  'Mail servers': '邮件服务器', 'TLS certificate verification is always enforced.': '始终强制验证 TLS 证书。', 'Port': '端口', 'Direct TLS': '安全连接',
  'Both servers are ready': '收件和发件服务器均已就绪', 'One or more servers could not connect': '一个或多个服务器连接失败',
  'Agent access': '智能体权限', 'Only selected agents receive email search and read tools.': '只有选中的智能体会获得邮件搜索和阅读工具。', 'Create a cloud agent before granting connector access.': '请先创建云端智能体，再授予连接器权限。',
  'Connection test failed': '连接测试失败', 'Email connection could not be saved': '无法保存邮箱连接', 'Email account could not be disconnected': '无法断开邮箱连接',
  'Disconnect this email account? Agents will immediately lose access.': '断开这个邮箱账户？智能体将立即失去访问权限。', 'Disconnect': '断开连接',
  'Testing…': '正在测试…', 'Connecting…': '正在连接…',
  'Complete the email address, username, and server settings.': '请填写完整的邮箱地址、用户名和服务器设置。', 'Enter the mailbox password or authorization code.': '请输入邮箱密码或授权码。',
  'Email connection failed.': '邮箱连接失败。', 'Email connection not found': '未找到邮箱连接', 'Email connection needs to be reconnected': '邮箱连接需要重新认证',
  'Version information and software updates.': '查看版本信息并管理软件更新。', 'Version': '版本', 'Checking for updates…': '正在检查更新…', 'Check for updates': '检查更新', 'You are up to date · Check again': '已是最新版本 · 再次检查', 'You are using the latest version.': '当前已是最新版本。', 'Update checks are available in packaged builds.': '当前为开发版；安装正式版后可检查更新。',
  'Downloading update…': '正在下载更新…', 'Downloading the verified update from Douchat…': '正在从 Douchat 正式发布渠道下载已验证的更新…', 'Connecting to the Douchat update service…': '正在连接 Douchat 更新服务…', 'Check for updates to compare this version with the latest release.': '检查更新以对比当前版本与最新正式版。', 'Version {version} is available': '发现新版本 {version}', 'Update to v{version} and restart': '更新到 v{version} 并重启', 'Update ready to install': '更新已准备好安装', 'Finish {count} active tasks before restarting.': '请先等待 {count} 个运行中的任务结束。', 'Restart to finish update': '重启并完成更新', 'Installing update and restarting…': '正在安装更新并重启…', 'Update failed:': '更新失败：', 'Updates are downloaded from signed Douchat releases. The app waits for active agent tasks before restarting.': '更新仅从 Douchat 正式发布渠道下载。若有智能体任务正在运行，应用会等待任务结束后再重启。',
  'Font size': '字体大小', 'Small': '小', 'Standard': '标准', 'Large': '大', 'Font preview': '字号预览', 'Messages and interface text update immediately.': '消息和界面文字将即时调整。',
  'Language': '语言', 'Appearance': '外观', 'Light': '浅色', 'Dark': '深色', 'System': '跟随系统',
  'Choose your language and appearance.': '设置界面语言和外观。',
  'Local proxies': '本地代理', 'View the local proxies available on this computer.': '查看这台电脑上可用的本地代理。',
  'Installed': '已安装', 'Not installed': '未安装', 'Refresh': '刷新', 'Scanning…': '扫描中…', 'Detect': '检测', 'Detecting…': '检测中…',
  'Installed · uses your local login and default model': '已安装 · 使用本地登录和默认模型', 'Installed · chat adapter coming soon': '已安装 · 暂不支持聊天',
  'Checking your shell and installed commands…': '正在检测已安装的命令…', 'No supported local proxies found. Install one in your terminal, then detect again.': '未检测到支持的本地代理。请先在终端中安装，然后重新检测。',
  'Configure the endpoint used by model-based bots.': '配置智能体使用的模型服务。', 'Endpoint connected': '已连接模型服务', 'Model API connected': '模型 API 已连接', 'Using provider credentials from the environment': '使用环境变量中的服务商凭据', 'Connect an endpoint': '连接模型服务', 'Use an OpenAI-compatible model provider': '使用兼容 OpenAI 的模型服务', 'Configure': '配置', 'Cloud models are provided by your Douchat account.': 'Cloud 模型由你的 Douchat 账号提供。', 'Douchat Cloud connected': 'Douchat Cloud 已连接', 'Douchat Cloud unavailable': 'Douchat Cloud 暂不可用', 'Available cloud models': '可用 Cloud 模型：{count}',
  'Manage your account and chat identity.': '管理登录账号和聊天身份。', 'Your account identity is used everywhere in Douchat.': '头像和昵称将在 Douchat 各处保持一致。', 'Signed-in account': '当前登录账号', 'Signed in to Douchat': '已登录 Douchat', 'Sign out': '退出登录', 'Signing out…': '正在退出…', 'Could not sign out. Try again.': '退出登录失败，请重试。', 'Chat profile': '聊天身份',
  'Profile picture': '头像', 'Change your picture': '修改头像', 'PNG or JPG. Your picture is synced to your Douchat account.': '支持 PNG 或 JPG，保存后将同步到你的 Douchat 账号。', 'Email': '邮箱', 'Save changes': '保存修改', 'Saved to your Douchat account': '已同步到 Douchat 账号', 'Changes sync to every signed-in Douchat app.': '修改后会同步到所有已登录的 Douchat。', 'Could not save account changes.': '账号资料保存失败，请重试。', 'Name cannot be empty.': '名称不能为空。',
  'How you appear in every conversation.': '设置你在聊天中的头像和名称。', 'PNG or JPG. It is cropped to a square and stays on this computer.': '支持 PNG 或 JPG，图片将裁剪为正方形并保存在本机。', 'Choose picture': '选择图片', 'Remove': '移除', 'Display name': '显示名称', 'Name': '名称', 'Your name': '你的名称', 'Your bots address you by this name.': '智能体会使用这个名称称呼你。',
  'Resize sidebar': '调整侧边栏宽度', 'Search contacts': '搜索联系人', 'Clear search': '清除搜索', 'No agents match “{query}”.': '没有与“{query}”匹配的智能体。',
  'Chats': '聊天', 'Contacts': '联系人', 'Search': '搜索', 'Search agents': '搜索智能体', 'New chat': '新建聊天', 'All chats': '全部聊天', 'Direct chats': '私聊', 'Group chats': '群聊', 'Unread': '未读', 'Mark all as read': '全部标为已读', 'New agent': '新建智能体', 'New group': '新建群聊', 'Working…': '正在处理…', 'Start a conversation': '开始聊天',
  'Chat details': '聊天详情', 'Group chat name': '群聊名称', 'Edit group chat name': '修改群聊名称', 'Add': '添加', 'Send message': '发送消息', 'No messages yet': '暂无消息', 'Emoji': '表情', 'Voice input': '语音输入', 'Start voice input': '开始语音输入', 'Stop voice input': '停止语音输入', 'Listening…': '正在听…', 'Starting microphone…': '正在启动麦克风…', 'Finishing voice input…': '正在结束语音输入…', 'Manage agents': '管理智能体', 'Cancel': '取消', 'Save': '保存', 'Edit': '编辑', 'Delete': '删除',
  'Today': '今天', 'Yesterday': '昨天', 'now': '刚刚', 'You': '你', 'Everyone': '所有人',
  'Hide': '收起', 'Details': '详情', 'Copy': '复制', 'Copied': '已复制', 'Send': '发送', 'Stop': '停止', 'Retry': '重试',
  'View source': '查看源码', 'Mermaid diagram could not be rendered': 'Mermaid 图表无法渲染', 'SVG image': 'SVG 图像', 'SVG could not be rendered safely. Check the code format.': 'SVG 无法安全渲染，请检查代码格式。',
  'Enlarge diagram': '放大图表', 'Close enlarged diagram': '关闭大图', 'Zoom in': '放大', 'Zoom out': '缩小', 'Reset view': '复位',
  'Open preview': '打开预览', 'Opening…': '正在打开…', 'Code preview could not be opened': '无法打开代码预览',
  'Open {name} in a separate window': '在独立窗口打开 {name}', '{count} lines': '{count} 行', 'lines': '行',
  'Preview': '效果', 'Source code': '源码', 'Copy source': '复制源码', 'Reload preview': '重新加载效果', 'Reload': '重新加载',
  'Code preview views': '代码预览视图', 'Rendered preview': '渲染效果', 'Loading preview…': '正在加载预览…',
  'This code preview is no longer available.': '此代码预览已失效，请从消息中重新打开。',
  'Private from {name}': '来自 {name} 的私信', 'Received privately from {name}': '收到来自 {name} 的私信', 'Private message from': '私信来自', 'Private message from {name}': '来自 {name} 的私信', 'From': '来自', 'From {name}': '来自 {name}', 'Private message to': '发送私信给', 'Private message details are unavailable.': '这条历史私信没有保存详情。', '{name} replied': '{name} 回复', 'Via {name}': '由 {name} 转达', 'Sent privately to {name}': '已私信发送给 {name}', 'Sent private message to {names}': '已发送私信给 {names}', 'Private message to {name}': '发送给 {name} 的私信', 'To': '发送给', 'To {name}': '发送给 {name}', 'Show private messages': '展开私信内容', 'Hide private messages': '收起私信内容', 'Handoff': '转交',
  'Message {name}': '给 {name} 发消息', 'Message {name} · @ to mention': '给 {name} 发消息 · 输入 @ 提及成员', 'Create an agent to start chatting': '创建智能体后开始聊天',
  'Send a message to {name}.': '给 {name} 发送一条消息。', 'Send a message to {name}, or @ a member to address them directly.': '给 {name} 发送消息，或输入 @ 直接提及成员。',
  'Choose a local proxy or connect a model endpoint to start chatting.': '请选择本地代理或连接模型服务后开始聊天。', 'Choose agent': '选择智能体',
  'Mention a member': '提及成员', 'Choose an emoji': '选择表情', 'Stop the current reply': '停止当前回复',
  'Image could not be loaded': '图片加载失败', 'Loading image': '正在加载图片', 'Agent generated image': '智能体生成的图片',
  'Images ready to send': '待发送图片', 'Pasted image': '粘贴的图片', 'Remove image': '移除图片',
  'Only PNG, JPEG, WebP, and GIF images are supported.': '仅支持 PNG、JPEG、WebP 和 GIF 图片。', 'Each image must be 8 MB or smaller.': '每张图片不能超过 8 MB。',
  'You can paste up to 4 images at a time.': '一次最多可粘贴 4 张图片。', 'Images must total 20 MB or less.': '图片总大小不能超过 20 MB。', 'Unsupported image format': '不支持的图片格式',
  'Pasted image could not be read.': '无法读取粘贴的图片。',
  'Microphone access is off. Allow {name} in System Settings, then restart the app.': '麦克风权限未开启。请在系统设置中允许 {name} 使用麦克风，然后重启应用。',
  'Open System Settings': '打开系统设置',
  'Voice input is unavailable in this version of Douchat.': '当前版本的 Douchat 无法使用语音输入。',
  'Voice input could not start. Try again.': '无法启动语音输入，请重试。',
  'No microphone was found.': '未找到可用的麦克风。',
  'No speech was detected. Try again.': '没有识别到语音，请重试。',
  'Voice recognition could not connect. Check your network and try again.': '语音识别服务连接失败，请检查网络后重试。',
  'Voice input stopped unexpectedly. Try again.': '语音输入意外停止，请重试。',
  'Invalid image attachments': '图片附件无效',
  '{name} is unavailable — {replacement} is standing in.': '{name} 当前不可用，由 {replacement} 暂时代替。',
  'No chats match “{query}”.': '没有与“{query}”匹配的聊天。', 'You: {message}': '你：{message}',
  'Put several agents in one room': '让多个智能体加入同一个群聊', 'Starred': '已置顶',
  'Pick an agent or a group to see its profile.': '选择一个智能体或群聊以查看资料。', 'Members': '成员', 'How this group works': '群聊运行方式',
  'The lead member opens the conversation, dispatches work and consolidates the result. Mention a member with @ to address them directly.': '主智能体负责开启对话、分配工作并汇总结果。输入 @ 可直接指定成员。',
  'Open the group chat': '进入群聊', 'Manage members': '管理成员', 'What this group is for': '群聊用途', 'topics': '个话题', 'members': '位成员',
  'Edit group': '编辑群聊', 'Lead member': '主智能体', 'Add a member': '添加成员',
  'Opening Douchat…': '正在打开 Douchat…', 'Close chat details': '关闭聊天详情', '{name} — open your profile': '{name} — 打开个人资料',
  'Close window': '关闭窗口', 'Minimize window': '最小化窗口', 'Toggle full screen': '切换全屏', 'Window controls': '窗口控制', 'Sections': '功能导航',
  'Message could not be sent': '消息发送失败', 'Agent could not be deleted': '无法删除智能体', 'Chat could not be deleted': '无法删除聊天', 'Chat could not be opened': '无法打开聊天', 'Chat could not be pinned': '无法更改置顶状态', 'Chat could not be updated': '无法更新聊天', 'Window could not be opened': '无法打开独立窗口',
  '{name} joined the workspace': '{name} 已加入工作区', '{name} updated': '已更新 {name}', 'Delete {name}? Their chat and group memberships are removed.': '确定删除 {name}？其私聊和群聊成员关系也会被移除。', '{name} was removed': '已移除 {name}', '{name} is ready': '{name} 已创建', 'Group updated': '群聊已更新',
  'Automation': '自动化', 'Create a routine': '创建例行任务', 'What should happen?': '需要执行什么？', 'Post results to': '将结果发送到', 'Schedule': '计划',
  'e.g. Review the morning brief': '例如：查看晨间简报', 'Give the agent a complete instruction, including the expected result.': '请提供完整指令，并说明期望的结果。',
  'Every day': '每天', 'Weekdays': '工作日', 'Every week': '每周', 'Repeating interval': '按间隔重复', 'Every 15 minutes': '每 15 分钟', 'Every 30 minutes': '每 30 分钟', 'Every hour': '每小时', 'Every 6 hours': '每 6 小时', 'Every 12 hours': '每 12 小时',
  'The app must be running. Missed times run once when the computer wakes.': '应用需要保持运行；电脑唤醒后会补执行一次错过的任务。',
  'Base URL': '基础 URL', 'API key': 'API 密钥', "Stored on this computer, in the app's own data folder.": '保存在此电脑的 Douchat 数据目录中。',
  'Invalid attachment id': '附件编号无效', 'Attachment not found': '未找到附件', 'Conversation not found': '未找到对话', 'This conversation is still replying': '当前对话仍在回复中',
  'Unknown local agent': '未知的本地代理', 'This local agent has no chat adapter yet': '该本地代理暂不支持聊天', 'Local agent failed': '本地代理运行失败', 'OpenCode failed': 'OpenCode 运行失败',
  'Routine name and instructions are required': '请输入例行任务名称和指令', 'Routine agent not found': '未找到例行任务的智能体', 'Routine conversation not found': '未找到例行任务的对话', 'Routine interval must be at least one minute': '例行任务的间隔不能少于一分钟', 'Choose at least one day and a valid time': '请选择至少一天并设置有效时间', 'Routine not found': '未找到例行任务',
  'A group needs at least one bot': '群聊至少需要一个智能体', 'Chat not found': '未找到聊天', 'Agent not found': '未找到智能体',
  'a contact': '联系人', '{count} members': '{count} 位成员', '{count} topics': '{count} 个话题',
  'Connected · {count} models': '已连接 · {count} 个模型', 'Endpoint saved': '模型服务已保存',
  'Installed proxies': '已安装的本地代理', 'Not installed proxies': '未安装的本地代理',
  'Untitled routine': '未命名例行任务', 'Choose an agent': '选择智能体', '{name} will run this in a private computer.': '{name} 将在专属电脑中执行此任务。',
  'Times use {timezone}.': '时间采用 {timezone} 时区。', 'Creating…': '正在创建…', 'Create routine': '创建例行任务',
  'Sunday': '星期日', 'Monday': '星期一', 'Tuesday': '星期二', 'Wednesday': '星期三', 'Thursday': '星期四', 'Friday': '星期五', 'Saturday': '星期六',
  'Not connected yet': '尚未连接', '{count} chat models available': '有 {count} 个聊天模型可用',
  'Currently read from .env — saving here overrides it.': '当前从 .env 读取；在此保存后将覆盖该配置。', 'Any OpenAI-compatible base URL works, including a local router.': '支持任何兼容 OpenAI 的基础 URL，包括本地路由服务。',
  'Saved — type to replace it': '已保存；输入新密钥即可替换', 'Reached the endpoint · {count} chat models': '已连接模型服务 · {count} 个聊天模型', 'Test connection': '测试连接', 'Checking…': '正在检查…', 'Save and connect': '保存并连接',
  'This window is newer than the running app. Quit and start it again (npm run dev).': '当前窗口比正在运行的主程序更新。请退出并重新启动应用（npm run dev）。',
  'Choose an image file.': '请选择图片文件。', 'This picture could not be prepared.': '无法处理这张图片。', 'This picture could not be read.': '无法读取这张图片。', 'Could not save agent': '智能体保存失败', 'Could not detect local proxies. Try Detect again.': '无法检测本地代理，请重新检测。'
}
