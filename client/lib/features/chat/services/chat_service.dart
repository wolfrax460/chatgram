import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../shared/models/chat_model.dart';
import '../../../shared/models/message_model.dart';
import '../../../shared/models/user_model.dart';
import '../../../shared/services/api_client.dart';
import '../../../shared/services/socket_service.dart';
import '../../auth/services/auth_service.dart';

/// Owns the chat list, per-chat message threads, typing state and the realtime
/// connection.
///
/// Notable fixes over the previous version:
///  * a sent message is no longer shown twice (the optimistic bubble is
///    replaced by the server's copy via `clientId`)
///  * messages are stored per chat, so opening another conversation no longer
///    shows the previous chat's history
///  * read receipts, presence, typing and `chat:new` events update the UI
///  * `GET /api/messages` returns `{messages, hasMore, nextCursor}`
class ChatService extends ChangeNotifier {
  ChatService(this._auth, {SocketService? socketService, ApiClient? apiClient})
      : socket = socketService ?? SocketService(),
        _api = apiClient ?? _auth.api {
    _bindSocket();
    // Signing out must tear the realtime connection down, otherwise the
    // socket stays authenticated as the previous user and keeps receiving
    // their messages.
    _wasAuthenticated = _auth.isAuthenticated;
    _auth.addListener(_onAuthChanged);
  }

  final AuthService _auth;
  final ApiClient _api;
  final SocketService socket;
  bool _wasAuthenticated = false;

  List<ChatModel> _chats = [];
  List<ChatModel> _groups = [];
  final Map<String, List<MessageModel>> _messagesByChat = {};
  final Map<String, String> _nextCursorByChat = {};
  final Map<String, bool> _hasMoreByChat = {};
  final Set<String> _typingKeys = {};

  bool _isLoadingChats = false;
  bool _isLoadingGroups = false;
  final Set<String> _loadingMessages = {};
  String? _errorMessage;
  String _activeChatId = '';

  int _clientIdCounter = 0;
  Timer? _typingDebounce;

  // --------------------------------------------------------------- getters
  List<ChatModel> get chats => List.unmodifiable(_chats);

  /// Groups I am a member of, newest activity first.
  List<ChatModel> get groups => List.unmodifiable(_groups);
  bool get isLoadingGroups => _isLoadingGroups;
  bool get isLoadingChats => _isLoadingChats;
  String? get errorMessage => _errorMessage;
  String get activeChatId => _activeChatId;
  String? get currentUserId => _auth.currentUser?.id;

  int get totalUnread =>
      _chats.fold(0, (sum, chat) => sum + (chat.id == _activeChatId ? 0 : chat.unreadCount));

  List<MessageModel> messagesFor(String chatId) =>
      List.unmodifiable(_messagesByChat[chatId] ?? const <MessageModel>[]);

  bool isLoadingMessages(String chatId) => _loadingMessages.contains(chatId);

  bool hasMoreMessages(String chatId) => _hasMoreByChat[chatId] ?? false;

  ChatModel? chatById(String chatId) {
    for (final chat in _chats) {
      if (chat.id == chatId) return chat;
    }
    // The Groups tab loads groups separately from the chat list.
    for (final group in _groups) {
      if (group.id == chatId) return group;
    }
    return null;
  }

  /// Fetch a single chat from the API (used when opening group info directly).
  Future<ChatModel?> fetchChat(String chatId) async {
    final cached = chatById(chatId);
    if (cached != null) return cached;

    final response = await _api.get('/api/chats/$chatId');
    if (response.ok && response.data is Map) {
      final chat = ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map));
      if (chat.isGroup) {
        final index = _groups.indexWhere((g) => g.id == chat.id);
        _groups = index == -1 ? [chat, ..._groups] : ([..._groups]..[index] = chat);
      }
      _upsertChat(chat);
      return chat;
    }
    return null;
  }

  /// True when somebody else is typing in [chatId].
  bool isOtherTyping(String chatId) =>
      _typingKeys.any((key) => key.startsWith('$chatId:') && !key.endsWith(':$currentUserId'));

  // ------------------------------------------------------------- lifecycle
  void _bindSocket() {
    socket.onNewMessage = _handleIncomingMessage;
    socket.onMessageDelivered = _handleDelivered;
    socket.onMessageRead = _handleRead;
    socket.onTyping = _handleTyping;
    socket.onChatNew = _handleChatNew;
    socket.onChatUpdated = _handleChatUpdated;
    socket.onChatRemoved = _handleChatRemoved;
    socket.onUserUpdated = _handleUserUpdated;
    socket.onPresence = _handlePresence;
    socket.onError = (message) {
      _errorMessage = message;
      notifyListeners();
    };
  }

  /// Connect/reconnect the socket and authenticate with the current token.
  void ensureSocket() {
    final token = _auth.token;
    if (token == null) return;
    socket.connect(token);
    if (_activeChatId.isNotEmpty) socket.joinChat(_activeChatId);
  }

  /// React to sign-in / sign-out.
  void _onAuthChanged() {
    final isAuthenticated = _auth.isAuthenticated;
    if (isAuthenticated == _wasAuthenticated) return;
    _wasAuthenticated = isAuthenticated;

    if (isAuthenticated) {
      ensureSocket();
      unawaited(loadChats());
    } else {
      _resetForSignOut();
    }
  }

  void _resetForSignOut() {
    socket.disconnect();
    _chats = [];
    _messagesByChat.clear();
    _nextCursorByChat.clear();
    _hasMoreByChat.clear();
    _typingKeys.clear();
    _activeChatId = '';
    _errorMessage = null;
    notifyListeners();
  }

  // ------------------------------------------------------------ chat list
  Future<bool> loadChats() async {
    if (_auth.token == null) {
      _setError('You are not signed in.');
      return false;
    }

    _isLoadingChats = true;
    notifyListeners();

    final response = await _api.get('/api/chats');
    _isLoadingChats = false;

    if (response.ok && response.data is List) {
      final list = (response.data as List)
          .whereType<Map>()
          .map((json) => ChatModel.fromJson(Map<String, dynamic>.from(json)))
          .toList();
      list.sort((a, b) => b.activityAt.compareTo(a.activityAt));
      _chats = list;
      _errorMessage = null;
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  /// Load only the groups I belong to (the Groups tab).
  Future<bool> loadGroups() async {
    if (_auth.token == null) return false;

    _isLoadingGroups = true;
    notifyListeners();

    final response = await _api.get('/api/chats/groups');
    _isLoadingGroups = false;

    if (response.ok && response.data is List) {
      _groups = (response.data as List)
          .whereType<Map>()
          .map((json) => ChatModel.fromJson(Map<String, dynamic>.from(json)))
          .toList();
      _errorMessage = null;
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  /// Open (or create) my conversation with the built-in support account.
  ///
  /// Every user has a permanent thread with Chatgram Support so they can report
  /// bugs, ask for help or request changes without knowing a username.
  Future<String?> openSupportChat() async {
    final response = await _api.post('/api/support/chat');

    if (response.ok && response.data is Map) {
      final chat = ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map));
      _upsertChat(chat);
      return chat.id;
    }

    if (response.errorCode == 'SUPPORT_NOT_CONFIGURED') {
      _setError('Support is not configured on this server yet.');
      return null;
    }

    _setError(response.errorMessage);
    return null;
  }

  /// Rename a group (admins only).
  Future<bool> renameGroup(String chatId, String newName) async {
    final response = await _api.patch('/api/chats/$chatId', body: {
      'groupName': newName,
    });

    if (response.ok && response.data is Map) {
      final chat = ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map));
      _upsertChat(chat);
      final index = _groups.indexWhere((g) => g.id == chatId);
      if (index != -1) {
        _groups = [..._groups]..[index] = chat;
      }
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  /// Promote or demote a group admin.
  Future<bool> setGroupAdmin(String chatId, String userId, {bool isAdmin = true}) async {
    final response = await _api.post('/api/chats/$chatId/admins', body: {
      'userId': userId,
      'isAdmin': isAdmin,
    });

    if (response.ok && response.data is Map) {
      _upsertChat(ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map)));
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  Future<String?> openDirectChat(String participantId) async {    final response = await _api.post('/api/chats', body: {
      'type': 'direct',
      'participantId': participantId,
    });

    if (response.ok && response.data is Map) {
      final chat = ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map));
      _upsertChat(chat);
      return chat.id;
    }

    _setError(response.errorMessage);
    return null;
  }

  Future<String?> createGroup({
    required String name,
    required List<String> participantIds,
  }) async {
    final response = await _api.post('/api/chats', body: {
      'type': 'group',
      'groupName': name,
      'participantIds': participantIds,
    });

    if (response.ok && response.data is Map) {
      final chat = ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map));
      _upsertChat(chat);
      return chat.id;
    }

    _setError(response.errorMessage);
    return null;
  }

  Future<bool> addGroupMembers(String chatId, List<String> userIds) async {
    final response = await _api.post('/api/chats/$chatId/participants', body: {
      'participantIds': userIds,
    });
    if (response.ok && response.data is Map) {
      _upsertChat(ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map)));
      return true;
    }
    _setError(response.errorMessage);
    return false;
  }

  /// Remove someone else from a group (admins only).
  Future<bool> removeGroupMember(String chatId, String userId) async {
    final response = await _api.delete('/api/chats/$chatId/participants/$userId');

    if (response.ok) {
      if (response.data is Map) {
        _upsertChat(ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map)));
      }
      await loadGroups();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  Future<bool> leaveGroup(String chatId) async {
    final myId = currentUserId;
    if (myId == null) return false;
    final response = await _api.delete('/api/chats/$chatId/participants/$myId');
    if (response.ok) {
      _chats.removeWhere((c) => c.id == chatId);
      _groups.removeWhere((c) => c.id == chatId);
      _messagesByChat.remove(chatId);
      if (_activeChatId == chatId) _activeChatId = '';
      notifyListeners();
      return true;
    }
    _setError(response.errorMessage);
    return false;
  }

  // ------------------------------------------------------------- messages
  /// Sets the conversation currently on screen. Clears the unread badge and
  /// tells the server the messages have been read.
  void setActiveChat(String chatId) {
    if (_activeChatId == chatId) return;
    final previous = _activeChatId;
    _activeChatId = chatId;

    if (previous.isNotEmpty) socket.leaveChat(previous);
    if (chatId.isNotEmpty) {
      socket.joinChat(chatId);
      unawaited(markChatRead(chatId));
    }
    _clearTyping(previous);
    notifyListeners();
  }

  Future<bool> loadMessages(String chatId, {bool loadMore = false}) async {
    if (_auth.token == null) return false;

    _loadingMessages.add(chatId);
    notifyListeners();

    final query = <String, dynamic>{'chatId': chatId, 'limit': 50};
    if (loadMore) {
      final cursor = _nextCursorByChat[chatId];
      if (cursor == null) {
        _loadingMessages.remove(chatId);
        notifyListeners();
        return false;
      }
      query['before'] = cursor;
    }

    final response = await _api.get('/api/messages', query: query);
    _loadingMessages.remove(chatId);

    if (response.ok && response.data is Map) {
      final data = Map<String, dynamic>.from(response.data as Map);
      final raw = (data['messages'] as List?) ?? const [];
      final page = raw
          .whereType<Map>()
          .map((json) => MessageModel.fromJson(Map<String, dynamic>.from(json)))
          .toList();

      if (loadMore) {
        final existing = _messagesByChat[chatId] ?? <MessageModel>[];
        // Older page goes in front.
        _messagesByChat[chatId] = [...page, ...existing];
      } else {
        _messagesByChat[chatId] = page;
      }

      _hasMoreByChat[chatId] = data['hasMore'] == true;
      if (data['nextCursor'] != null) {
        _nextCursorByChat[chatId] = data['nextCursor'].toString();
      }

      _errorMessage = null;
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  /// Sends a message, adding an optimistic bubble immediately.
  Future<bool> sendMessage({
    required String chatId,
    required String type,
    String? content,
    String? mediaUrl,
  }) async {
    final myId = currentUserId;
    if (myId == null) return false;

    final clientId = 'c${DateTime.now().microsecondsSinceEpoch}-${_clientIdCounter++}';
    final optimistic = MessageModel(
      id: 'local-$clientId',
      clientId: clientId,
      chatId: chatId,
      senderId: myId,
      type: MessageModel.parseMessageType(type),
      content: content,
      mediaUrl: mediaUrl,
      sentAt: DateTime.now(),
      deliveredTo: [myId],
      readBy: [myId],
    );

    final thread = _messagesByChat.putIfAbsent(chatId, () => <MessageModel>[]);
    thread.add(optimistic);
    _promoteChat(chatId, optimistic);
    notifyListeners();

    if (!socket.isConnected) {
      // Recover the connection, then fall back to REST so the message is not
      // silently lost when the socket is down.
      ensureSocket();
      final response = await _api.post('/api/messages', body: {
        'chatId': chatId,
        'type': type,
        if (content != null) 'content': content,
        if (mediaUrl != null) 'mediaUrl': mediaUrl,
        'clientId': clientId,
      });

      if (response.ok && response.data is Map) {
        _replaceOptimistic(
          chatId,
          clientId,
          MessageModel.fromJson(Map<String, dynamic>.from(response.data as Map)),
        );
        return true;
      }

      _markFailed(chatId, clientId);
      _setError(response.errorMessage);
      return false;
    }

    socket.sendMessage(
      chatId: chatId,
      type: type,
      content: content,
      mediaUrl: mediaUrl,
      clientId: clientId,
    );
    return true;
  }

  /// Re-send a message that previously failed.
  ///
  /// Reuses the original `clientId`, so the server's dedupe treats this as the
  /// same message. Previously "Retry" called [sendMessage], which minted a new
  /// clientId and pushed a second bubble — so a failed message appeared twice
  /// once connectivity came back.
  Future<bool> resendMessage(String chatId, MessageModel failed) async {
    final clientId = failed.clientId;
    if (clientId == null) return false;

    // Flip the existing bubble back to "sending" — no new bubble is added.
    _markFailed(chatId, clientId, failed: false);
    ensureSocket();

    final response = await _api.post('/api/messages', body: {
      'chatId': chatId,
      'type': failed.messageTypeString,
      if (failed.content != null) 'content': failed.content,
      if (failed.mediaUrl != null) 'mediaUrl': failed.mediaUrl,
      'clientId': clientId,
    });

    if (response.ok && response.data is Map) {
      _replaceOptimistic(
        chatId,
        clientId,
        MessageModel.fromJson(Map<String, dynamic>.from(response.data as Map)),
      );
      return true;
    }

    _markFailed(chatId, clientId);
    _setError(response.errorMessage);
    return false;
  }

  Future<bool> sendMediaMessage({
    required String chatId,
    required List<int> bytes,
    required String filename,
    required String type, // image | video | audio | file
    String? mimeType,
    String? caption,
  }) async {
    final response = await _api.upload(
      '/api/messages/media',
      bytes: bytes,
      filename: filename,
      field: 'file',
      mimeType: mimeType,
      // Chat attachments always live in uploads/media. This used to send
      // `status` for images, which filed them under uploads/status.
      fields: const {'type': 'media'},
    );

    if (!response.ok || response.data is! Map) {
      _setError(response.errorMessage);
      return false;
    }

    final data = Map<String, dynamic>.from(response.data as Map);
    final file = data['file'];
    final url = (file is Map ? file['url'] : null)?.toString();
    if (url == null) {
      _setError('Upload succeeded but no URL was returned.');
      return false;
    }

    return sendMessage(
      chatId: chatId,
      type: type,
      content: caption,
      mediaUrl: url,
    );
  }

  // --------------------------------------------------------------- receipts
  Future<void> markChatRead(String chatId) async {
    socket.markChatAsRead(chatId);

    final thread = _messagesByChat[chatId];
    final myId = currentUserId;
    if (thread != null && myId != null) {
      final updated = thread.map((m) {
        if (m.senderId == myId) return m;
        final readBy = {...m.readBy, myId}.toList();
        final deliveredTo = {...m.deliveredTo, myId}.toList();
        return m.copyWith(readBy: readBy, deliveredTo: deliveredTo);
      }).toList();
      _messagesByChat[chatId] = updated;
    }

    _updateChat(chatId, (chat) => chat.copyWith(unreadCount: 0));

    // REST fallback keeps the server in sync even if the socket is down.
    await _api.post('/api/messages/chat/$chatId/read');
    notifyListeners();
  }

  // ----------------------------------------------------------------- typing
  void notifyTyping(String chatId) {
    socket.sendTypingStart(chatId);
    _typingDebounce?.cancel();
    _typingDebounce = Timer(const Duration(seconds: 2), () {
      socket.sendTypingStop(chatId);
    });
  }

  void stopTyping(String chatId) {
    _typingDebounce?.cancel();
    socket.sendTypingStop(chatId);
  }

  // -------------------------------------------------------------- socket rx
  void _handleIncomingMessage(MessageModel message) {
    final thread = _messagesByChat.putIfAbsent(message.chatId, () => <MessageModel>[]);

    // Replace the optimistic bubble if this is our own message coming back.
    if (message.clientId != null) {
      final idx = thread.indexWhere((m) => m.clientId == message.clientId);
      if (idx != -1) {
        thread[idx] = message;
        _promoteChat(message.chatId, message);
        _sortThread(message.chatId);
        notifyListeners();
        return;
      }
    }

    if (thread.any((m) => m.id == message.id)) return;
    thread.add(message);
    _sortThread(message.chatId);
    _promoteChat(message.chatId, message);

    final isMine = message.senderId == currentUserId;
    final isActive = message.chatId == _activeChatId;

    if (!isMine) {
      if (isActive) {
        socket.markMessageAsDelivered(message.id);
        socket.markMessageAsRead(message.id);
        _bumpUnread(message.chatId, 0);
      } else {
        socket.markMessageAsDelivered(message.id);
        _bumpUnread(message.chatId, 1);
      }
    }

    notifyListeners();
  }

  void _handleDelivered(String messageId, String chatId, String userId) {
    if (chatId.isEmpty) return;
    _mutateMessage(chatId, (m) =>
        m.id == messageId ? m.copyWith(deliveredTo: {...m.deliveredTo, userId}.toList()) : m);
  }

  void _handleRead(String chatId, String userId, {bool all = false}) {
    if (chatId.isEmpty || userId.isEmpty) return;

    final thread = _messagesByChat[chatId];
    if (thread == null) return;

    _messagesByChat[chatId] = thread.map((m) {
      if (userId == currentUserId) return m;
      if (all || m.senderId == currentUserId) {
        return m.copyWith(
          readBy: {...m.readBy, userId}.toList(),
          deliveredTo: {...m.deliveredTo, userId}.toList(),
        );
      }
      return m;
    }).toList();
    notifyListeners();
  }

  void _handleTyping(String chatId, String userId, bool isTyping) {
    if (chatId.isEmpty || userId.isEmpty) return;
    final key = '$chatId:$userId';
    if (isTyping) {
      _typingKeys.add(key);
    } else {
      _typingKeys.remove(key);
    }
    notifyListeners();
  }

  void _handleChatNew(ChatModel chat) {
    _upsertChat(chat);
    socket.joinChat(chat.id);
  }

  void _handleChatUpdated(ChatModel chat) => _upsertChat(chat);

  void _handleChatRemoved(String chatId) {
    _chats.removeWhere((c) => c.id == chatId);
    _messagesByChat.remove(chatId);
    if (_activeChatId == chatId) _activeChatId = '';
    notifyListeners();
  }

  void _handleUserUpdated(UserModel user) {
    var changed = false;
    _chats = _chats.map((chat) {
      final idx = chat.participants.indexWhere((p) => p.id == user.id);
      if (idx == -1) return chat;
      final participants = [...chat.participants];
      participants[idx] = user;
      changed = true;
      return chat.copyWith(participants: participants);
    }).toList();
    if (changed) notifyListeners();
  }

  void _handlePresence(String userId, bool isOnline, DateTime? lastSeen) {
    var changed = false;
    _chats = _chats.map((chat) {
      final idx = chat.participants.indexWhere((p) => p.id == userId);
      if (idx == -1) return chat;
      final participants = [...chat.participants];
      participants[idx] = participants[idx].copyWith(
        isOnline: isOnline,
        lastSeen: lastSeen ?? participants[idx].lastSeen,
      );
      changed = true;
      return chat.copyWith(participants: participants);
    }).toList();
    if (changed) notifyListeners();
  }

  // --------------------------------------------------------------- helpers
  void _sortThread(String chatId) {
    final thread = _messagesByChat[chatId];
    if (thread == null) return;
    thread.sort((a, b) => a.sentAt.compareTo(b.sentAt));
  }

  void _replaceOptimistic(String chatId, String clientId, MessageModel persisted) {
    final thread = _messagesByChat[chatId];
    if (thread == null) return;
    final idx = thread.indexWhere((m) => m.clientId == clientId);
    if (idx != -1) {
      thread[idx] = persisted;
    } else if (!thread.any((m) => m.id == persisted.id)) {
      thread.add(persisted);
    }
    _sortThread(chatId);
    _promoteChat(chatId, persisted);
    notifyListeners();
  }

  void _markFailed(String chatId, String clientId, {bool failed = true}) {
    final thread = _messagesByChat[chatId];
    if (thread == null) return;
    final idx = thread.indexWhere((m) => m.clientId == clientId);
    if (idx != -1) thread[idx] = thread[idx].copyWith(failed: failed);
    notifyListeners();
  }

  void _mutateMessage(String chatId, MessageModel Function(MessageModel) update) {
    final thread = _messagesByChat[chatId];
    if (thread == null) return;
    _messagesByChat[chatId] = thread.map(update).toList();
    notifyListeners();
  }

  void _upsertChat(ChatModel chat) {
    final idx = _chats.indexWhere((c) => c.id == chat.id);
    if (idx == -1) {
      _chats = [chat, ..._chats];
    } else {
      // Preserve local unread count if the server payload omits it.
      final existing = _chats[idx];
      _chats = [..._chats]..[idx] = chat.copyWith(
          unreadCount: chat.unreadCount == 0 && existing.unreadCount > 0
              ? (chat.id == _activeChatId ? 0 : existing.unreadCount)
              : chat.unreadCount,
        );
    }
    _chats.sort((a, b) => b.activityAt.compareTo(a.activityAt));
    notifyListeners();
  }

  void _updateChat(String chatId, ChatModel Function(ChatModel) update) {
    final idx = _chats.indexWhere((c) => c.id == chatId);
    if (idx == -1) return;
    final next = [..._chats];
    next[idx] = update(next[idx]);
    _chats = next;
  }

  void _bumpUnread(String chatId, int count) {
    _updateChat(chatId, (chat) => chat.copyWith(unreadCount: count));
  }

  /// Move [chatId] to the top and refresh its last-message preview.
  void _promoteChat(String chatId, MessageModel message) {
    final idx = _chats.indexWhere((c) => c.id == chatId);
    if (idx == -1) return;

    final updated = _chats[idx].copyWith(
      lastMessage: message,
      updatedAt: message.sentAt,
    );
    _chats = [updated, ..._chats.where((c) => c.id != chatId)];
  }

  void _clearTyping(String chatId) {
    if (chatId.isEmpty) return;
    _typingKeys.removeWhere((key) => key.startsWith('$chatId:'));
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  void _setError(String message) {
    _errorMessage = message;
    notifyListeners();
  }

  @override
  void dispose() {
    _typingDebounce?.cancel();
    _auth.removeListener(_onAuthChanged);
    socket.dispose();
    super.dispose();
  }
}
