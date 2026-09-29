// Connectors are hidden until the service is ready for public use. While off,
// Settings has no Connectors tab and agents get no connector tools.
export const CONNECTORS_ENABLED = false

export type ConnectorPlatform = 'github' | 'notion' | 'linear'
export interface ConnanyConnection {
  id: string
  provider: ConnectorPlatform
  status: 'connected' | 'reauth_required' | 'revoked'
  display_name?: string
  identity: { account_name?: string; workspace_name?: string; needs_installation?: boolean }
  revocation_status?: string
}
export interface ConnanySession {
  id: string
  provider: ConnectorPlatform
  status: 'pending' | 'authorizing' | 'processing' | 'connected' | 'error' | 'expired'
  expires_at: string
  target_connection_id?: string
  connection_id?: string | null
  error_code?: string | null
  error_message?: string
}
export interface ConnectorSelection { provider: ConnectorPlatform; connectionId: string }
export interface ConnectorBinding { agentId: string; provider: ConnectorPlatform; connectionId: string }
export interface ConnanyState {
  providers: { name: ConnectorPlatform; enabled: boolean; installation_url?: string }[]
  connections: ConnanyConnection[]
  selections: ConnectorSelection[]
  sessions?: ConnanySession[]
}
export type ConnectorCommand = { op: 'rename'; id: string; name: string } | { op: 'installGithub' } | { op: 'list' } | { op: 'connect'; provider: ConnectorPlatform } | { op: 'session' | 'reconnect' | 'disconnect'; id: string }
