import { interpolate } from './groupText'
import type { InterfaceLanguage } from './language'

export const gameTranslations: Record<string, string> = {
  "Judge": "判官",
  "Civilian": "平民",
  "Good": "好人",
  "Undercover": "卧底",
  "Wolf": "狼人",
  "Seer": "预言家",
  "abstain": "弃权",
  "Game over: {winner} wins.\nRoles: {roles}": "游戏结束：{winner}获胜。\n身份揭晓：{roles}",
  "Round {round}, {phase}. Speak in order: {members}.": "第 {round} 轮{phase}。请依次发言：{members}。",
  "day": "白天",
  "descriptions": "描述",
  "Night {round}. Wolves discuss and choose a target privately; the seer then inspects. Night actions stay private.": "第 {round} 夜。狼人私下讨论并选择目标，预言家随后查验；夜间行动不会公开。",
  "Daybreak: {member} was eliminated last night.": "天亮了，{member}昨夜出局。",
  "Daybreak: nobody was eliminated last night.": "天亮了，昨夜无人出局。",
  "Surviving players vote privately{restriction}. One vote each, no self-votes. Results appear after all votes are collected.": "请存活玩家私下投票{restriction}。每人一票，禁止自投；全部收齐后公开。",
  " (tied candidates only)": "（仅限平票候选）",
  "Round {round} {phase} results: {votes}": "第 {round} 轮{phase}结果：{votes}",
  "revote": "重投",
  "vote": "投票",
  "Tie: candidates defend in order, then vote again once. Another tie is resolved by the seeded draw announced at the start.": "出现平票：候选人依次辩论后重投一次；再平票则按开局规则抽签。",
  "{prefix}{member} was eliminated.": "{prefix}{member}出局。",
  "Tie draw: ": "平票抽签：",
  "Invalid game phase.": "游戏阶段无效。",
  "Invalid player list. At most one human is supported.": "玩家列表无效。当前支持一个真人。",
  "Undercover requires 4–8 players.": "谁是卧底需要 4–8 名玩家。",
  "Simplified Werewolf requires 6 players: 2 wolves, 1 seer, 3 civilians.": "简化狼人杀需要 6 名玩家（2 狼、1 预言家、3 平民）。",
  "Undercover game": "谁是卧底",
  "Simplified Werewolf": "简化狼人杀",
  "{game} begins. The rules service is the judge and does not play. {rules}\nSpeak in seat order and vote privately. The first legal vote counts. A tie permits one defense and revote, then a random draw. Two invalid agent actions skip a speech or abstain; three consecutive invalid slots or a persistent service failure pause the game. Wait for human input; pausing and cancelling are supported.": "{game}开始。判官由规则服务担任，不参赛。{rules}\n按座次发言，私下投票，首次合法投票生效；平票辩论重投一次，再平票随机抽签。Agent 连续两次行动格式无效则跳过发言或弃权；连续三个行动槽异常或模型服务持续不可用则暂停。真人无响应时等待，可暂停或结束。",
  "One undercover; no blank cards or word-guess comeback. Eliminating the undercover wins for civilians; two survivors with the undercover alive wins for the undercover.": "1 名卧底，无白板，无猜词翻盘；卧底出局则平民胜，否则剩两人时卧底胜。",
  "Two wolves, one seer, three civilians; no special last-words skills. No wolves means good wins; wolves at least equal to surviving good players means wolves win.": "2 狼、1 预言家、3 平民，无特殊遗言技能；狼全灭好人胜，狼人数不少于好人则狼人胜。",
  "Your word: {word}. Do not say it directly. You do not know whether you are undercover.": "你的词语：{word}。不要直接说出词语；你不知道自己是否为卧底。",
  "Your role: {role}.{partners}": "你的身份：{role}。{partners}",
  " Wolf teammates: {members}.": "狼人同伴：{members}。",
  "The speech or vote has expired. Use the current action.": "发言或投票已过期，请使用当前行动。",
  "Enter a speech of 1–2000 characters.": "请输入 1–2000 字的发言。",
  "Enter only the speech, without private-message or message-break directives.": "请输入发言正文，不要包含私信或分段指令。",
  "Describe the word without saying it directly.": "请描述词语的特征，不要直接说出自己的词语。",
  "Select a valid target other than yourself or an eliminated player.": "请选择有效目标（不能选择自己或出局成员）。",
  "Inspection: {member} belongs to the {team} team.": "查验结果：{member}属于{team}阵营。",
  "This action cannot be skipped.": "不能跳过当前行动。",
  "Three consecutive slots had no valid model output. Check player model settings before continuing.": "连续三个行动槽无有效模型输出，请检查玩家模型设置后继续。",
  "Two invalid model actions; abstaining or skipping under the rules.": "模型连续两次未提交合法行动，按规则弃权 / 跳过。",
  "(No valid speech this turn; skipped under the rules.)": "（本轮未提交有效发言，按规则跳过。）",
  "Not a player in this game.": "不是本局玩家。",
  "Select a local group owned by your account.": "请选择自己的本地群聊。",
  "Invalid game player configuration.": "游戏玩家配置无效。",
  "This topic already has a game. End it first.": "当前话题已有游戏，请先结束它。",
  "Fair-game tests require isolated cloud agents without tools. Use a cloud-only test group.": "公平游戏只使用云端 Agent 的隔离无工具会话。请创建仅包含云端 Agent 的测试群。",
  "Only agents owned by your account may play.": "当前游戏仅支持自己的 Agent。",
  "You": "你",
  "You may only submit your own actions.": "只能提交自己的行动。",
  "Game not found.": "游戏不存在。",
  "Invalid game control.": "游戏操作无效。",
  "The game has ended or no longer exists.": "游戏已经结束或不存在。",
  "The player was removed or no longer supports isolated game sessions.": "玩家 Agent 已删除或不再支持隔离游戏会话。",
  "The model did not return a valid game action.": "模型没有返回有效游戏行动。",
  "Model request timed out.": "模型请求超时。",
  "The model service is unavailable or the action has expired. Check player model settings before continuing.": "模型服务暂不可用或行动已过期，请检查玩家模型设置后继续。",
  "{member} cannot complete this action. {detail}": "{member} 暂时无法完成行动。{detail}",
  "The activity reached its execution budget. The game is paused.": "达到本次活动执行预算，游戏已暂停。",
  "The game is paused.": "游戏已暂停。",
  "The game does not belong to the current account.": "游戏不属于当前账号。",
  "A player left the group. End this game and select players again.": "游戏玩家已离开群聊，请结束本局后重新选择玩家。",
  "Game state has changed.": "游戏状态已更新。",
  "Game identity cannot be changed.": "游戏身份不能修改。"
}
export function gameText(language: InterfaceLanguage, key: string, values: Record<string, string | number> = {}): string {
  return interpolate(language === 'zh-CN' ? gameTranslations[key] ?? key : key, values)
}
/** Control flow uses the code, never a localized error message. */
export class GameRuleError extends Error {
  constructor(readonly code: string, language: InterfaceLanguage = 'en') { super(gameText(language, code)) }
}
export const gameWordPairs: Record<InterfaceLanguage, string[][]> = {
  'en': [['coffee', 'milk tea'], ['moon', 'sun'], ['train', 'subway'], ['orange', 'lemon'], ['umbrella', 'raincoat'], ['piano', 'guitar']],
  'zh-CN': [['咖啡', '奶茶'], ['月亮', '太阳'], ['火车', '地铁'], ['橙子', '柠檬'], ['雨伞', '雨衣'], ['钢琴', '吉他']]
}
