export interface SocialFile { name: string; base64: string }
export interface SocialImage { name: string; mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'; base64: string }
/** An image in a fetched message page, by reference: fetched once with the `attachment` action. */
export interface SocialImageRef { name: string; mimeType: SocialImage['mimeType']; size: number; ref: string; base64?: undefined }
/** Message pages carry images inline (older services) or as refs (`attachments: 'ref'`). */
export type SocialMessageImage = SocialImage | SocialImageRef
export interface SocialPerson { order?: number; id: string; name: string; email: string; image?: string }
export interface SocialAgentAppearance { interactionHumans?: 'allow' | 'ask' | 'deny'; interactionAgents?: 'allow' | 'ask' | 'deny'; avatar?: string; avatarEmoji?: string; avatarSeed?: string; color?: string; localAgentId?: string; systemRole?: 'admin' }
export interface SocialAgent extends SocialAgentAppearance { onlineUntil?: number; approvalTaskId?: string; order?: number; id: string; localId: string; ownerId: string; name: string }
export interface SocialRoom { revision?: string; id: string; name: string; kind: 'direct' | 'group' | 'agent'; members: SocialPerson[]; agents: SocialAgent[]; createdAt: string }
export interface SocialFriendship { id: string; senderId: string; recipientId: string; status: 'pending' | 'accepted' | 'declined'; person: SocialPerson }
export interface SocialSnapshot { filesVersion?: number; permissionsVersion?: number; syncVersion?: number; userId: string; friendships: SocialFriendship[]; rooms: SocialRoom[] }
export interface SocialMessage { parentMessageId?: string; id: string; roomId: string; authorId: string; authorName: string; content: string; images?: SocialMessageImage[]; files?: SocialFile[]; agentId?: string; agentName?: string; status: 'sent' | 'pending' | 'running' | 'succeeded' | 'failed'; reply?: string; replyImages?: SocialMessageImage[]; replyFiles?: SocialFile[]; createdAt: string }
export interface GroupInvite { roomId: string; name: string; token: string; expiresAt: string | null; url: string }
export type SocialAction =
  | { action: 'leave-room'; roomId: string }
  | { action: 'group-invite'; conversationId: string; regenerate?: boolean }
  | { action: 'rename-room'; roomId: string; name: string }
  | { action: 'remove-members'; roomId: string; friendIds: string[]; agentIds: string[] }
  | { action: 'invite-members'; conversationId: string; friendIds: string[]; agentIds: string[] }
  | { action: 'add-members'; roomId: string; friendIds: string[] }
  | { action: 'lookup'; email: string }
  | { action: 'request'; email: string }
  | { action: 'respond'; id: string; accept: boolean }
  | { action: 'create-room'; kind: 'direct' | 'group'; name?: string; friendIds: string[]; memberOrder?: string[]; agentIds?: string[] }
  | { action: 'create-room'; kind: 'agent'; localId: string; name: string } & SocialAgentAppearance
  | { action: 'add-agent' | 'remove-agent'; roomId: string; localId: string; order?: number }
  | { action: 'messages'; roomId: string; before?: string; after?: { time: string; id: string }; pending?: string[]; attachments?: 'ref' }
  | { action: 'attachment'; roomId: string; ref: string }
  | { action: 'send'; roomId: string; id: string; content: string; images?: SocialImage[]; files?: SocialFile[]; agentId?: string }
export type SocialRelationship = 'none' | 'self' | 'accepted' | 'outgoing' | 'incoming'
export interface SocialResult { snapshot?: SocialSnapshot; invite?: GroupInvite; conversationId?: string; person?: SocialPerson | null; relationship?: SocialRelationship; friendshipId?: string; roomId?: string; messages?: SocialMessage[]; updates?: SocialMessage[]; hasMore?: boolean }
/** Tasks always carry their images inline. */
export interface SocialTask extends Omit<SocialMessage, 'images' | 'replyImages'> { images?: SocialImage[]; replyImages?: SocialImage[]; requesterAgentId?: string; roomName?: string; context?: string; claim: string; agent: SocialAgent; ownerId: string }

export interface SocialTaskReply { text: string; images?: SocialImage[]; files?: SocialFile[] }

/** Re-read the last few seconds before a cursor, so equal timestamps and commit order never drop a message. */
export const overlapCursor = (cursor: { time: string; id: string }) => ({ time: new Date(Math.max(0, Date.parse(cursor.time) - 5000)).toISOString(), id: '' })
