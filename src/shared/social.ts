export interface SocialImage { name: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; base64: string }
export interface SocialPerson { order?: number; id: string; name: string; email: string; image?: string }
export interface SocialAgentAppearance { avatar?: string; avatarEmoji?: string; avatarSeed?: string; color?: string; localAgentId?: string; systemRole?: 'admin' }
export interface SocialAgent extends SocialAgentAppearance { order?: number; id: string; localId: string; ownerId: string; name: string }
export interface SocialRoom { id: string; name: string; kind: 'direct' | 'group'; members: SocialPerson[]; agents: SocialAgent[]; createdAt: string }
export interface SocialFriendship { id: string; senderId: string; recipientId: string; status: 'pending' | 'accepted' | 'declined'; person: SocialPerson }
export interface SocialSnapshot { userId: string; friendships: SocialFriendship[]; rooms: SocialRoom[] }
export interface SocialMessage { parentMessageId?: string; id: string; roomId: string; authorId: string; authorName: string; content: string; images?: SocialImage[]; agentId?: string; agentName?: string; status: 'sent' | 'pending' | 'running' | 'succeeded' | 'failed'; reply?: string; createdAt: string }
export type SocialAction =
  | { action: 'rename-room'; roomId: string; name: string }
  | { action: 'remove-members'; roomId: string; friendIds: string[]; agentIds: string[] }
  | { action: 'invite-members'; conversationId: string; friendIds: string[]; agentIds: string[] }
  | { action: 'add-members'; roomId: string; friendIds: string[] }
  | { action: 'lookup'; email: string }
  | { action: 'request'; email: string }
  | { action: 'respond'; id: string; accept: boolean }
  | { action: 'create-room'; kind: 'direct' | 'group'; name?: string; friendIds: string[]; memberOrder?: string[] }
  | { action: 'add-agent' | 'remove-agent'; roomId: string; localId: string; order?: number }
  | { action: 'messages'; roomId: string; before?: string }
  | { action: 'send'; roomId: string; id: string; content: string; images?: SocialImage[]; agentId?: string }
export type SocialRelationship = 'none' | 'self' | 'accepted' | 'outgoing' | 'incoming'
export interface SocialResult { conversationId?: string; person?: SocialPerson | null; relationship?: SocialRelationship; friendshipId?: string; roomId?: string; messages?: SocialMessage[]; hasMore?: boolean }
export interface SocialTask extends SocialMessage { context?: string; claim: string; agent: SocialAgent; ownerId: string }
