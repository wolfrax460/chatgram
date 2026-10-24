/**
 * Domain models for Chatgram.
 *
 * Shapes mirror what the backend actually returns (see docs/api-contract.md).
 * `fromJson` helpers are deliberately tolerant: the API returns `_id` or `id`,
 * and `senderId` may be either a string or a populated user object.
 */

// 'system' rows are created by the server for group events ("Alice left").
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'system';

/** Delivery state from the current user's perspective. */
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type ChatType = 'direct' | 'group';

export interface User {
  id: string;
  displayName: string;
  email?: string;
  phone?: string;
  about?: string;
  avatarUrl?: string;
  isOnline?: boolean;
  lastSeen?: string;
  role?: 'user' | 'admin';
}

export interface MessageReaction {
  userId: string;
  emoji: string;
}

export interface Message {
  id: string;
  clientId?: string;
  chatId: string;
  senderId: string;
  /** Populated when the API includes the sender object (group sender names). */
  sender?: User;
  type: MessageType;
  content?: string;
  mediaUrl?: string;
  sentAt: string;
  deliveredTo: string[];
  readBy: string[];
  reactions: MessageReaction[];
  isDeleted?: boolean;
  failed?: boolean;
}

export interface Chat {
  id: string;
  type: ChatType;
  participants: User[];
  groupName?: string;
  groupAvatarUrl?: string;
  admins?: string[];
  lastMessage?: Message;
  unreadCount?: number;
  updatedAt?: string;
  /** Group description + metadata (additive). */
  description?: string;
  createdBy?: string;
  settings?: {
    whoCanEditInfo: 'all' | 'admins';
    whoCanSendMessages: 'all' | 'admins';
    whoCanAddMembers: 'all' | 'admins';
  };
  inviteEnabled?: boolean;
  pinnedMessageId?: string;
}

export type StatusMediaType = 'image' | 'video' | 'audio';

export interface StatusItem {
  id: string;
  userId: User;
  text?: string;
  mediaUrl?: string;
  /** Older rows have a mediaUrl and no type; they are images. */
  mediaType?: StatusMediaType;
  thumbnailUrl?: string;
  durationSeconds?: number;
  createdAt: string;
  viewedBy: User[];
}

export interface Privacy {
  showOnlineStatus: boolean;
  hiddenFrom: User[];
  showPhone?: boolean;
  showEmail?: boolean;
  showAbout?: boolean;
  showProfilePhoto?: boolean;
  readReceipts?: boolean;
  whoCanAddToGroups?: 'everyone' | 'contacts';
}

/** The API uses `_id` for some resources; normalise it away. */
export function idOf(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return String(rec._id ?? rec.id ?? '');
  }
  return String(value);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => idOf(v)).filter(Boolean);
}

export function userFromJson(json: unknown): User {
  const j = (json ?? {}) as Record<string, unknown>;
  return {
    id: idOf(j),
    displayName: String(j.displayName ?? 'Unknown'),
    email: j.email ? String(j.email) : undefined,
    phone: j.phone ? String(j.phone) : undefined,
    about: j.about ? String(j.about) : undefined,
    avatarUrl: j.avatarUrl ? String(j.avatarUrl) : undefined,
    isOnline: j.isOnline === true,
    lastSeen: j.lastSeen ? String(j.lastSeen) : undefined,
    role: j.role === 'admin' ? 'admin' : 'user',
  };
}

export function messageFromJson(json: unknown): Message {
  const j = (json ?? {}) as Record<string, unknown>;
  const rawSender = j.senderId;
  const sender =
    rawSender && typeof rawSender === 'object' && (rawSender as Record<string, unknown>).displayName
      ? userFromJson(rawSender)
      : undefined;
  return {
    id: idOf(j),
    clientId: j.clientId ? String(j.clientId) : undefined,
    chatId: idOf(j.chatId),
    senderId: idOf(j.senderId),
    sender,
    type: (j.type as MessageType) ?? 'text',
    content: j.content ? String(j.content) : undefined,
    mediaUrl: j.mediaUrl ? String(j.mediaUrl) : undefined,
    sentAt: String(j.sentAt ?? new Date().toISOString()),
    deliveredTo: asStringArray(j.deliveredTo),
    readBy: asStringArray(j.readBy),
    reactions: Array.isArray(j.reactions)
      ? (j.reactions as Record<string, unknown>[]).map((r) => ({
          userId: idOf(r.userId),
          emoji: String(r.emoji ?? ''),
        }))
      : [],
    isDeleted: j.isDeleted === true,
    failed: j.failed === true,
  };
}

export function chatFromJson(json: unknown): Chat {
  const j = (json ?? {}) as Record<string, unknown>;
  return {
    id: idOf(j),
    type: j.type === 'group' ? 'group' : 'direct',
    participants: Array.isArray(j.participants)
      ? j.participants.map(userFromJson)
      : [],
    groupName: j.groupName ? String(j.groupName) : undefined,
    groupAvatarUrl: j.groupAvatarUrl ? String(j.groupAvatarUrl) : undefined,
    admins: asStringArray(j.admins),
    lastMessage: j.lastMessage ? messageFromJson(j.lastMessage) : undefined,
    unreadCount: typeof j.unreadCount === 'number' ? j.unreadCount : 0,
    updatedAt: j.updatedAt ? String(j.updatedAt) : undefined,
    description: j.groupDescription ? String(j.groupDescription) : undefined,
    createdBy: j.groupCreatedBy ? idOf(j.groupCreatedBy) : undefined,
    settings: (() => {
      const raw = j.groupSettings as Record<string, unknown> | undefined;
      if (!raw) return undefined;
      return {
        whoCanEditInfo: raw.whoCanEditInfo === 'admins' ? ('admins' as const) : ('all' as const),
        whoCanSendMessages: raw.whoCanSendMessages === 'admins' ? ('admins' as const) : ('all' as const),
        whoCanAddMembers: raw.whoCanAddMembers === 'admins' ? ('admins' as const) : ('all' as const),
      };
    })(),
    inviteEnabled: j.inviteEnabled === true,
    pinnedMessageId: j.pinnedMessageId ? idOf(j.pinnedMessageId) : undefined,
  };
}

export function statusFromJson(json: unknown): StatusItem {
  const j = (json ?? {}) as Record<string, unknown>;
  const kind = j.mediaType ? String(j.mediaType) : j.mediaUrl ? 'image' : undefined;
  return {
    id: idOf(j),
    userId: userFromJson(j.userId),
    text: j.text ? String(j.text) : undefined,
    mediaUrl: j.mediaUrl ? String(j.mediaUrl) : undefined,
    mediaType:
      kind === 'image' || kind === 'video' || kind === 'audio' ? kind : undefined,
    thumbnailUrl: j.thumbnailUrl ? String(j.thumbnailUrl) : undefined,
    durationSeconds: typeof j.durationSeconds === 'number' ? j.durationSeconds : undefined,
    createdAt: String(j.createdAt ?? new Date().toISOString()),
    viewedBy: Array.isArray(j.viewedBy) ? j.viewedBy.map(userFromJson) : [],
  };
}

/* ----------------------------------------------------------------- display */

/** The other participant of a direct chat. */
export function chatPartner(chat: Chat, meId: string): User | undefined {
  return chat.participants.find((p) => p.id !== meId);
}

export function chatTitle(chat: Chat, meId: string): string {
  if (chat.type === 'group') return chat.groupName || 'Group';
  const partner = chatPartner(chat, meId);
  if (!partner) return 'Saved messages';
  return partner.displayName || 'Unknown';
}

export function chatAvatarName(chat: Chat, meId: string): string {
  if (chat.type === 'group') return chat.groupName || 'Group';
  return chatPartner(chat, meId)?.displayName || 'Chat';
}

/** Derive a message's delivery status for the current user. */
export function statusForMessage(
  message: Message,
  meId: string,
  participantIds: string[],
): MessageStatus {
  if (message.failed) return 'failed';
  if (message.id.startsWith('temp-')) return 'sending';

  const others = participantIds.filter((id) => id !== meId);
  if (others.length === 0) return 'sent';
  if (message.readBy.some((id) => others.includes(id))) return 'read';
  if (message.deliveredTo.some((id) => others.includes(id))) return 'delivered';
  return 'sent';
}

/** Short preview text for the chat list. */
export function messagePreview(message?: Message, fallback = 'Tap to start chatting'): string {
  if (!message) return fallback;
  if (message.content?.trim()) return message.content.trim();
  switch (message.type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎥 Video';
    case 'audio':
      return '🎤 Voice message';
    case 'file':
      return '📄 Document';
    default:
      return fallback;
  }
}
