export type IMProvider = 'wechat' | 'feishu' | 'telegram'
export interface IMChannel {
  provider: IMProvider
  agentId: string
  label: string
  status: 'connecting' | 'connected' | 'error'
  error?: string
  paired: boolean
  pairingCode?: string
}
export interface IMConnectInput { provider: 'telegram' | 'feishu'; token?: string; appId?: string; appSecret?: string }
export interface IMLogin { sessionId: string; qr: string }
export interface IMLoginStatus { status: 'wait' | 'scaned' | 'confirmed' | 'expired' }
