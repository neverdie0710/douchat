export type IMProvider = 'wechat' | 'feishu' | 'wecom' | 'telegram'
export type IMQRProvider = 'wechat' | 'feishu' | 'wecom'
export interface IMChannel {
  provider: IMProvider
  agentId: string
  label: string
  status: 'connecting' | 'connected' | 'error'
  error?: string
  paired: boolean
  pairingCode?: string
}
export interface IMConnectInput { provider: 'telegram' | 'feishu' | 'wecom'; token?: string; appId?: string; appSecret?: string; botId?: string; secret?: string }
export interface IMLogin { sessionId: string; qr: string }
export interface IMLoginStatus { status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'denied' }
