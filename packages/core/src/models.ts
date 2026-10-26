/**
 * Domain models for Chatgram.
 *
 * Shapes mirror what the backend actually returns (see docs/api-contract.md).
 * `fromJson` helpers are deliberately tolerant: the API returns `_id` or `id`,
 * and `senderId` may be either a string or a populated user object.
 */

// 'system' rows are created by the server for group events ("Alice left").
// 'call' rows are the persisted call cards inside a conversation.
export type MessageType = 'text' | 'image' | 'video' | 'audio' | 'file' | 'system' | 'call';

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

/** One participant of a persisted call card. */
export interface CallCardParticipant {
  id: string;
  displayName?: string;
  avatarUrl?: string | null;
  audioOnly?: boolean;
  muted?: boolean;
  cameraOn?: boolean;
  screenSharing?: boolean;
}

/**
 * The persisted metadata of a group/1:1 call card message (`type: 'call'`).
 * The server updates it live through the `call:card-updated` event.
 */
export interface CallCardInfo {
  callId: string;
  chatId: string;
  video: boolean;
  mode: 'voice' | 'video';
  isGroup: boolean;
  title: string;
  state: 'ringing' | 'active' | 'ended';
  status: 'ringing' | 'completed' | 'missed' | 'declined' | 'busy' | 'failed' | 'cancelled';
  startedBy: { id: string; displayName: string; avatarUrl?: string | null } | null;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  participantCount: number;
  participants: CallCardParticipant[];
  /** Total room cap (12 for both voice and video rooms). */
  capacity: number;
  /** Camera slots (6 for a video room, 0 for a voice room). */
  videoCapacity?: number;
  cameraCount?: number;
  endReason: string | null;
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
  /** Set when the sender edited the text (shows "edited" in the bubble). */
  editedAt?: string;
  /** Users who starred this message (per-user bookmark). */
  starredBy?: string[];
  /** True when the signed-in reader starred it (server convenience field). */
  starred?: boolean;
  /**
   * Chunk 1C: allow-list of users who may read this message. Empty/absent means
   * everyone in the chat. A private group AI question/answer lists only the asker.
   */
  visibleTo?: string[];
  /** Convenience flag from the API: true when visibleTo is non-empty. */
  private?: boolean;
  /** For a private AI answer/notice: the asker's mention message it answers. */
  aiReplyTo?: string;
  /** Persisted call-card metadata (only on `type: 'call'` messages). */
  call?: CallCardInfo;
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
    requireApproval: boolean;
    /** "@Chatgram AI" mentions are allowed in this group (off by default). */
    aiMentions?: boolean;
    /** Who can see AI answers: only the asker (default) or everyone. */
    aiReplyVisibility?: 'asker' | 'everyone';
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

export function callCardFromJson(raw: unknown): CallCardInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const j = raw as Record<string, unknown>;
  const state = j.state === 'ringing' || j.state === 'ended' ? j.state : 'active';
  const statusRaw = String(j.status ?? 'ringing');
  const status =
    statusRaw === 'completed' ||
    statusRaw === 'missed' ||
    statusRaw === 'declined' ||
    statusRaw === 'busy' ||
    statusRaw === 'failed' ||
    statusRaw === 'cancelled'
      ? statusRaw
      : 'ringing';
  const startedByRaw = (j.startedBy ?? null) as Record<string, unknown> | null;
  const mode = j.mode === 'video' || j.video === true ? 'video' : 'voice';
  return {
    callId: String(j.callId ?? ''),
    chatId: idOf(j.chatId),
    video: j.video === true || mode === 'video',
    mode,
    isGroup: j.isGroup === true,
    title: String(j.title ?? ''),
    state,
    status,
    startedBy: startedByRaw
      ? {
          id: idOf(startedByRaw),
          displayName: String(startedByRaw.displayName ?? ''),
          avatarUrl: startedByRaw.avatarUrl ? String(startedByRaw.avatarUrl) : null,
        }
      : null,
    startedAt: j.startedAt ? String(j.startedAt) : null,
    answeredAt: j.answeredAt ? String(j.answeredAt) : null,
    endedAt: j.endedAt ? String(j.endedAt) : null,
    durationSeconds: typeof j.durationSeconds === 'number' ? j.durationSeconds : 0,
    participantCount: typeof j.participantCount === 'number' ? j.participantCount : 0,
    participants: Array.isArray(j.participants)
      ? (j.participants as Record<string, unknown>[]).map((participant) => ({
          id: idOf(participant),
          displayName: participant.displayName ? String(participant.displayName) : undefined,
          avatarUrl: participant.avatarUrl ? String(participant.avatarUrl) : null,
          audioOnly: participant.audioOnly === true,
          muted: participant.muted === true,
          cameraOn: participant.cameraOn !== false,
          screenSharing: participant.sharingKind ? true : participant.screenSharing === true,
        }))
      : [],
    capacity: typeof j.capacity === 'number' ? j.capacity : 0,
    videoCapacity: typeof j.videoCapacity === 'number' ? j.videoCapacity : undefined,
    cameraCount: typeof j.cameraCount === 'number' ? j.cameraCount : undefined,
    endReason: j.endReason ? String(j.endReason) : null,
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
    editedAt: j.editedAt ? String(j.editedAt) : undefined,
    starredBy: asStringArray(j.starredBy),
    starred: j.starred === true,
    visibleTo: asStringArray(j.visibleTo),
    private: j.private === true || asStringArray(j.visibleTo).length > 0,
    aiReplyTo: j.aiReplyTo ? idOf(j.aiReplyTo) : undefined,
    call: j.call ? callCardFromJson(j.call) : undefined,
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
    // The API returns `groupAvatar`; older local storage used `groupAvatarUrl`.
    groupAvatarUrl:
      j.groupAvatarUrl || j.groupAvatar ? String(j.groupAvatarUrl || j.groupAvatar) : undefined,
    admins: (() => {
      const adminIds = asStringArray(j.admins);
      if (adminIds.length > 0) return adminIds;
      // Server field name is groupAdmins.
      return asStringArray(j.groupAdmins);
    })(),
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
        requireApproval: raw.requireApproval === true,
        aiMentions: raw.aiMentions === true,
        aiReplyVisibility: raw.aiReplyVisibility === 'everyone' ? ('everyone' as const) : ('asker' as const),
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
    case 'call':
      return '📞 Call';
    default:
      return fallback;
  }
}
