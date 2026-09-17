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
export function t(text: string): string { return current.language === 'zh-CN' ? translations[text] || text : text }
const translations: Record<string, string> = {
  'Could not reach the login service. Check your connection and try again.': '无法连接登录服务，请检查网络后重试。', 'This login request has expired. Start again.': '本次登录请求已过期，请重新开始。', 'The login request expired or was already used. Start again.': '本次登录请求已过期或已经使用，请重新开始。', 'Authorization code is invalid, expired, or already used': '授权码无效、已过期或已经使用，请重新开始。', 'Login callback could not be verified': '无法验证登录回调，请重新开始。', 'Login callback did not include a valid authorization code': '登录回调中没有有效的授权码。', 'Login service returned an invalid session.': '登录服务返回了无效会话。', 'Login service returned an invalid user.': '登录服务返回了无效用户信息。', 'Secure credential storage is unavailable on this computer.': '此电脑无法使用安全凭证存储。', 'Douchat Cloud Chat is not enabled or its upstream model is not configured.': 'Douchat Cloud Chat 尚未启用，或上游模型尚未配置。',
  'Meet Douchat': '遇见 Douchat', 'Your smartest collaboration partner.': '你最聪明的协作伙伴。', 'Continue in browser': '在浏览器中继续', 'Open login page again': '重新打开登录页', 'Secure browser login': '安全的浏览器登录', 'Waiting for browser login…': '正在等待浏览器登录…', 'Finish signing in in your browser. Douchat will return automatically.': '请在浏览器中完成登录，成功后将自动返回 Douchat。', 'Your password stays in the browser. Douchat only receives a one-time authorization code.': '密码始终保留在浏览器中，Douchat 只接收一次性授权码。', 'Login could not be completed': '登录未完成', 'Encrypted session storage on this device': '登录凭证已在此设备上加密保存', 'Checking your login…': '正在检查登录状态…',
  'Search group members': '搜索群成员', 'Remove group members': '移出群成员', 'Select members to remove': '从左侧选择要移出的群成员', 'Keep at least one member': '群聊至少保留一位成员',
  'Group members': '群聊成员', 'Create group': '创建群聊', 'Add group members': '添加群成员', 'Already added': '已加入', 'Selected contacts': '已选联系人', 'Select contacts to add': '从左侧选择要添加的联系人', 'No matching contacts': '没有匹配的联系人',
  'Edit contact': '编辑联系人', 'Contact menu': '联系人菜单', 'Edit contact information': '修改联系人信息', 'Delete contact': '删除联系人', 'Avatar': '头像', 'Nickname': '昵称', 'Description': '描述', 'Add a description': '添加更多描述信息', 'Search or create labels': '搜索或创建标签…', 'Done': '完成', 'This picture could not be used.': '无法使用这张图片。', 'Role': '角色', 'Contact details': '联系人资料', 'Instructions': '行为指令', 'Labels': '标签', 'More information': '更多信息', 'Shared groups': '共同群聊', 'Source': '来源', 'Model endpoint': '模型服务', 'Added on': '添加时间',
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
  'Contact name': '联系人名称', 'Enter contact name': '输入联系人名称', 'Agent type': 'Agent 类型', 'Cloud agent': 'Cloud Agent', 'Local agent': '本地 Agent', 'Uses the cloud default model': '使用云端默认模型', 'Use this computer': '使用本机环境', 'Select a local agent': '选择本地 Agent', 'No available local agents': '暂无可用的本地 Agent', 'Saving…': '保存中…', 'Close': '关闭',
  'Settings': '设置', 'Profile': '个人资料', 'Account': '账号', 'General': '通用', 'Agents': '智能体', 'Models': '模型',
  'Font size': '字体大小', 'Small': '小', 'Standard': '标准', 'Large': '大', 'Font preview': '字号预览', 'Messages and interface text update immediately.': '消息和界面文字将即时调整。',
  'Language': '语言', 'Appearance': '外观', 'Light': '浅色', 'Dark': '深色', 'System': '跟随系统',
  'Choose your language and appearance.': '设置界面语言和外观。',
  'Local agents': '本地智能体', 'Connect the agents on this computer to your contacts.': '将此电脑上的智能体添加为联系人。',
  'Each contact has its own name, instructions and conversation history. Local agents use their existing login and model settings.': '每个联系人拥有独立的名称、指令和聊天记录。本地智能体沿用已有的登录和模型设置。',
  'Installed': '已安装', 'Not installed': '未安装', 'Create contact': '创建联系人', 'Refresh': '刷新', 'Scanning…': '扫描中…',
  'Installed · uses your local login and default model': '已安装 · 使用本地登录和默认模型', 'Installed · chat adapter coming soon': '已安装 · 暂不支持聊天',
  'Checking your shell and installed commands…': '正在检测已安装的命令…', 'No supported agent commands found. Install an agent in your terminal, then refresh.': '未检测到支持的智能体。安装后请刷新。',
  'Configure the endpoint used by model-based bots.': '配置智能体使用的模型服务。', 'Endpoint connected': '已连接模型服务', 'Model API connected': '模型 API 已连接', 'Using provider credentials from the environment': '使用环境变量中的服务商凭据', 'Connect an endpoint': '连接模型服务', 'Use an OpenAI-compatible model provider': '使用兼容 OpenAI 的模型服务', 'Configure': '配置', 'Cloud models are provided by your Douchat account.': 'Cloud 模型由你的 Douchat 账号提供。', 'Douchat Cloud connected': 'Douchat Cloud 已连接', 'Douchat Cloud unavailable': 'Douchat Cloud 暂不可用', 'Available cloud models': '可用 Cloud 模型：{count}',
  'Manage your account and chat identity.': '管理登录账号和聊天身份。', 'Your account identity is used everywhere in Douchat.': '头像和昵称将在 Douchat 各处保持一致。', 'Signed-in account': '当前登录账号', 'Signed in to Douchat': '已登录 Douchat', 'Sign out': '退出登录', 'Signing out…': '正在退出…', 'Could not sign out. Try again.': '退出登录失败，请重试。', 'Chat profile': '聊天身份',
  'Profile picture': '头像', 'Change your picture': '修改头像', 'PNG or JPG. Your picture is synced to your Douchat account.': '支持 PNG 或 JPG，保存后将同步到你的 Douchat 账号。', 'Email': '邮箱', 'Save changes': '保存修改', 'Saved to your Douchat account': '已同步到 Douchat 账号', 'Changes sync to every signed-in Douchat app.': '修改后会同步到所有已登录的 Douchat。', 'Could not save account changes.': '账号资料保存失败，请重试。', 'Name cannot be empty.': '名称不能为空。',
  'How you appear in every conversation.': '设置你在聊天中的头像和名称。', 'PNG or JPG. It is cropped to a square and stays on this computer.': '支持 PNG 或 JPG，图片将裁剪为正方形并保存在本机。', 'Choose picture': '选择图片', 'Remove': '移除', 'Display name': '显示名称', 'Name': '名称', 'Your name': '你的名称', 'Your bots address you by this name.': '智能体会使用这个名称称呼你。',
  'Resize sidebar': '调整侧边栏宽度', 'Search contacts': '搜索联系人', 'Clear search': '清除搜索',
  'Chats': '聊天', 'Contacts': '联系人', 'Search': '搜索', 'New chat': '新建聊天', 'All chats': '全部聊天', 'Direct chats': '私聊', 'Group chats': '群聊', 'Unread': '未读', 'Mark all as read': '全部标为已读', 'New bot': '新建智能体', 'New group': '新建群聊', 'Working…': '正在处理…', 'Start a conversation': '开始聊天',
  'Chat details': '聊天详情', 'Chat settings': '聊天设置', 'Bot settings': '智能体设置', 'Add': '添加', 'Send message': '发送消息', 'No messages yet': '暂无消息', 'Emoji': '表情', 'Manage bots': '管理智能体', 'Bots': '智能体', 'Cancel': '取消', 'Save': '保存', 'Edit': '编辑', 'Delete': '删除'
}
