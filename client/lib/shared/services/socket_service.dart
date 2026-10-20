import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;

import '../../server_config.dart';
import '../models/chat_model.dart';
import '../models/message_model.dart';
import '../models/user_model.dart';

/// Wraps the Socket.IO connection and exposes typed callbacks.
///
/// Previously almost every incoming event landed in a `// TODO` stub, so read
/// receipts, presence and typing indicators never reached the UI. They are all
/// wired now.
class SocketService extends ChangeNotifier {
  io.Socket? _socket;
  String? _token;

  bool _isConnected = false;
  bool _isConnecting = false;
  String? _errorMessage;
  int _retryCount = 0;

  bool get isConnected => _isConnected;
  bool get isConnecting => _isConnecting;
  String? get errorMessage => _errorMessage;

  // ------------------------------------------------------------- callbacks
  void Function(MessageModel message)? onNewMessage;
  void Function(String messageId, String chatId, String userId)? onMessageDelivered;
  void Function(String chatId, String userId, {bool all})? onMessageRead;
  void Function(UserModel user)? onUserUpdated;
  void Function(String chatId, String userId, bool isTyping)? onTyping;
  void Function(ChatModel chat)? onChatNew;
  void Function(ChatModel chat)? onChatUpdated;
  void Function(String chatId)? onChatRemoved;
  void Function(String userId, bool isOnline, DateTime? lastSeen)? onPresence;
  void Function(String message)? onError;

  SocketService();

  /// Connect (or reconnect) using [token].
  void connect(String token) {
    _token = token;

    if (_socket != null) {
      if (_socket!.connected) {
        _socket!.emit('authenticate', token);
        return;
      }
      if (_isConnecting) return;
    }

    _disposeSocket();
    _isConnecting = true;
    _errorMessage = null;
    notifyListeners();

    try {
      // Do NOT force a websocket-only transport: behind some proxies/AV the
      // websocket upgrade is blocked and the original app hung on
      // "Socket connection error: timeout". Polling is a safe fallback and the
      // server now accepts both.
      final socket = io.io(
        socketBaseUrl,
        io.OptionBuilder()
            .setTransports(['websocket', 'polling'])
            .enableAutoConnect()
            .enableReconnection()
            .setReconnectionAttempts(20)
            .setReconnectionDelay(1000)
            .setReconnectionDelayMax(5000)
            .setAuth({'token': token})
            .build(),
      );
      _socket = socket;

      socket.on('connect', (_) {
        _isConnected = true;
        _isConnecting = false;
        _errorMessage = null;
        _retryCount = 0;
        notifyListeners();
        // Re-authenticate on every (re)connect: room memberships are lost
        // whenever the underlying connection drops.
        socket.emit('authenticate', _token);
      });

      socket.on('disconnect', (_) {
        _isConnected = false;
        _isConnecting = false;
        notifyListeners();
      });

      socket.on('connect_error', (data) {
        _isConnecting = false;
        _retryCount++;
        _errorMessage = 'Realtime connection failed ($_retryCount). Retrying…';
        notifyListeners();
        debugPrint('Socket connect_error: $data');
      });

      socket.on('authenticated', (data) {
        _isConnected = true;
        _isConnecting = false;
        _errorMessage = null;
        notifyListeners();
        debugPrint('Socket authenticated');
      });

      socket.on('auth_error', (data) {
        _errorMessage = 'Realtime authentication failed';
        notifyListeners();
        debugPrint('Socket auth_error: $data');
      });

      // ------------------------------------------------------- messages
      socket.on('message:new', (data) {
        final message = _toMessage(data);
        if (message != null) onNewMessage?.call(message);
      });

      socket.on('message:delivered', (data) {
        final map = _asMap(data);
        if (map == null) return;
        onMessageDelivered?.call(
          (map['messageId'] ?? '').toString(),
          (map['chatId'] ?? '').toString(),
          (map['userId'] ?? '').toString(),
        );
      });

      socket.on('message:read', (data) {
        final map = _asMap(data);
        if (map == null) return;
        onMessageRead?.call(
          (map['chatId'] ?? '').toString(),
          (map['userId'] ?? '').toString(),
          all: map['all'] == true,
        );
      });

      socket.on('message:error', (data) {
        final map = _asMap(data);
        onError?.call(map?['message']?.toString() ?? 'Message failed to send');
      });

      // ------------------------------------------------------- presence
      socket.on('presence:online', (data) {
        final map = _asMap(data);
        final userId = (map?['userId'] ?? data).toString();
        onPresence?.call(userId, true, null);
      });

      socket.on('presence:offline', (data) {
        final map = _asMap(data);
        final userId = (map?['userId'] ?? '').toString();
        final lastSeen = map?['lastSeen'] != null
            ? DateTime.tryParse(map!['lastSeen'].toString())?.toLocal()
            : null;
        if (userId.isNotEmpty) onPresence?.call(userId, false, lastSeen);
      });

      // --------------------------------------------------------- typing
      socket.on('typing:start', (data) {
        final map = _asMap(data);
        if (map == null) return;
        onTyping?.call((map['chatId'] ?? '').toString(), (map['userId'] ?? '').toString(), true);
      });

      socket.on('typing:stop', (data) {
        final map = _asMap(data);
        if (map == null) return;
        onTyping?.call((map['chatId'] ?? '').toString(), (map['userId'] ?? '').toString(), false);
      });

      // ---------------------------------------------------------- chats
      socket.on('chat:new', (data) {
        final map = _asMap(data);
        if (map == null) return;
        onChatNew?.call(ChatModel.fromJson(map));
      });

      socket.on('chat:updated', (data) {
        final map = _asMap(data);
        if (map == null) return;
        onChatUpdated?.call(ChatModel.fromJson(map));
      });

      socket.on('chat:removed', (data) {
        final map = _asMap(data);
        final chatId = (map?['chatId'] ?? '').toString();
        if (chatId.isNotEmpty) onChatRemoved?.call(chatId);
      });

      socket.on('user:updated', (data) {
        final map = _asMap(data);
        if (map == null) return;
        onUserUpdated?.call(UserModel.fromJson(map));
      });

      socket.connect();
    } catch (e) {
      _isConnecting = false;
      _errorMessage = 'Could not start realtime client: $e';
      notifyListeners();
      debugPrint('Socket initialization error: $e');
    }
  }

  // ------------------------------------------------------------- emitting
  void sendMessage({
    required String chatId,
    required String type,
    String? content,
    String? mediaUrl,
    String? clientId,
  }) {
    _emit('message:send', {
      'chatId': chatId,
      'type': type,
      'content': content,
      'mediaUrl': mediaUrl,
      'clientId': clientId,
    });
  }

  void markMessageAsDelivered(String messageId) =>
      _emit('message:delivered', {'messageId': messageId});

  void markMessageAsRead(String messageId) =>
      _emit('message:read', {'messageId': messageId});

  /// Mark every unread message in a chat as read.
  void markChatAsRead(String chatId) => _emit('message:read', {'chatId': chatId});

  void sendTypingStart(String chatId) => _emit('typing:start', {'chatId': chatId});

  void sendTypingStop(String chatId) => _emit('typing:stop', {'chatId': chatId});

  void joinChat(String chatId) => _emit('chat:join', {'chatId': chatId});

  void leaveChat(String chatId) => _emit('chat:leave', {'chatId': chatId});

  void _emit(String event, Map<String, dynamic> payload) {
    final socket = _socket;
    if (socket == null || !socket.connected) {
      debugPrint('Socket not connected; dropped "$event"');
      return;
    }
    socket.emit(event, payload);
  }

  void disposeSocket() => _disposeSocket();

  /// Disconnect but keep the instance reusable.
  ///
  /// Used on sign-out so a logged-out client does not keep receiving the
  /// previous user's messages on an authenticated socket.
  void disconnect() {
    _token = null;
    _isConnected = false;
    _isConnecting = false;
    _retryCount = 0;
    _disposeSocket();
    notifyListeners();
  }

  void _disposeSocket() {
    final socket = _socket;
    _socket = null;
    if (socket == null) return;
    try {
      socket.clearListeners();
      socket.disconnect();
      socket.dispose();
    } catch (_) {
      // Ignore teardown races.
    }
  }

  @override
  void dispose() {
    _disposeSocket();
    super.dispose();
  }

  // -------------------------------------------------------------- helpers
  static Map<String, dynamic>? _asMap(dynamic data) {
    if (data is Map) return Map<String, dynamic>.from(data);
    return null;
  }

  static MessageModel? _toMessage(dynamic data) {
    final map = _asMap(data);
    if (map == null) return null;
    try {
      return MessageModel.fromJson(map);
    } catch (e) {
      debugPrint('Failed to parse incoming message: $e');
      return null;
    }
  }
}
