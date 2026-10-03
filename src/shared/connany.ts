// Connectors are reached through the Douchat backend, which holds the Connany
// project key. While off, Settings has no Connectors tab and agents get no
// connector tools.
export const CONNECTORS_ENABLED = true

// The available connectors come from Connany's GET /v1/connectors (whatever the
// administrator enabled). Names only need to be safe in tool names and URLs.
export type ConnectorName = string
export const isConnectorName = (value: unknown): value is ConnectorName => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,31}$/.test(value)

export interface ConnanyConnector { name: ConnectorName; title: string; description?: string; avatar_url: string }
export interface ConnanyConnection {
  id: string
  connector: ConnectorName
  status: 'connected' | 'reauth_required' | 'revoked'
  display_name?: string
  identity: { account_name?: string; workspace_name?: string }
  /** The user still has to grant resource access (see the `access` command). */
  needs_access?: boolean
  revocation_status?: string
}
export interface ConnanySession {
  id: string
  connector: ConnectorName
  status: 'pending' | 'authorizing' | 'processing' | 'connected' | 'error' | 'expired'
  expires_at: string
  target_connection_id?: string
  connection_id?: string | null
  error_code?: string | null
  error_message?: string
}
export interface ConnanyAccess {
  add_url: string | null
  total: number
  next_page: number | null
  data: { id: string; type: string; name: string; selection: 'all' | 'selected'; suspended: boolean; manage_url: string | null }[]
}
/** Persisted per login account and backend origin; `provider` is the connector name. */
export interface ConnectorSelection { provider: ConnectorName; connectionId: string }
export interface ConnectorBinding { agentId: string; provider: ConnectorName; connectionId: string }
export interface ConnanyState {
  connectors: ConnanyConnector[]
  connections: ConnanyConnection[]
  selections: ConnectorSelection[]
  sessions?: ConnanySession[]
  allow_writes?: boolean
}
export type ConnectorCommand =
  | { op: 'list' }
  | { op: 'rename'; id: string; name: string }
  | { op: 'connect'; connector: ConnectorName }
  | { op: 'session'; connector: ConnectorName; id: string }
  | { op: 'reconnect' | 'disconnect' | 'check' | 'access'; id: string }
  /** Opens `add_url`, or one of the returned `manage_url`s, after re-reading them. */
  | { op: 'openAccess'; id: string; url?: string }
