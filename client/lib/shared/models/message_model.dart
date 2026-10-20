import '../../server_config.dart';

enum MessageType { text, image, video, audio, file }

/// Delivery state of a message from the *current user's* perspective.
enum MessageStatus { sending, sent, delivered, read, failed }

class MessageModel {
  final String id;

  /// Client-generated id echoed back by the server so an optimistic bubble can
  /// be replaced by the persisted one instead of appearing twice.
  final String? clientId;

  final String chatId;
  final String senderId;
  final MessageType type;
  final String? content;
  final String? mediaUrl;
  final DateTime sentAt;
  final List<String> deliveredTo;
  final List<String> readBy;
  final bool failed;

  MessageModel({
    required this.id,
    this.clientId,
    required this.chatId,
    required this.senderId,
    required this.type,
    this.content,
    this.mediaUrl,
    required this.sentAt,
    required this.deliveredTo,
    required this.readBy,
    this.failed = false,
  });

  factory MessageModel.fromJson(Map<String, dynamic> json) {
    // `senderId` arrives either as an id string or a populated user object.
    String senderId = '';
    final rawSender = json['senderId'];
    if (rawSender is Map) {
      senderId = (rawSender['_id'] ?? rawSender['id'] ?? '').toString();
    } else if (rawSender != null) {
      senderId = rawSender.toString();
    }

    return MessageModel(
      id: (json['_id'] ?? json['id'] ?? '').toString(),
      clientId: json['clientId']?.toString(),
      chatId: (json['chatId'] ?? '').toString(),
      senderId: senderId,
      type: parseMessageType(json['type']),
      content: json['content']?.toString(),
      mediaUrl: json['mediaUrl']?.toString(),
      sentAt: _parseDate(json['sentAt']) ?? DateTime.now(),
      deliveredTo: _stringList(json['deliveredTo']),
      readBy: _stringList(json['readBy']),
    );
  }

  static DateTime? _parseDate(dynamic value) {
    if (value == null) return null;
    if (value is DateTime) return value;
    return DateTime.tryParse(value.toString())?.toLocal();
  }

  static List<String> _stringList(dynamic value) {
    if (value is! List) return const [];
    return value
        .map((e) => e is Map ? (e['_id'] ?? e['id'] ?? '').toString() : e.toString())
        .where((e) => e.isNotEmpty)
        .toList();
  }

  static MessageType parseMessageType(dynamic type) {
    switch (type) {
      case 'image':
        return MessageType.image;
      case 'video':
        return MessageType.video;
      case 'audio':
        return MessageType.audio;
      case 'file':
        return MessageType.file;
      default:
        return MessageType.text;
    }
  }

  String get messageTypeString {
    switch (type) {
      case MessageType.image:
        return 'image';
      case MessageType.video:
        return 'video';
      case MessageType.audio:
        return 'audio';
      case MessageType.file:
        return 'file';
      case MessageType.text:
        return 'text';
    }
  }

  /// Absolute URL for attached media.
  String get resolvedMediaUrl => ServerConfig.resolveMedia(mediaUrl);

  bool get isMedia => type != MessageType.text;
  bool get isText => type == MessageType.text;
  bool get isPending => id.startsWith('local-');

  /// Delivery status shown as ticks in the chat bubble.
  MessageStatus statusFor(String? myId, Iterable<String> otherParticipantIds) {
    if (failed) return MessageStatus.failed;
    if (isPending) return MessageStatus.sending;

    final others = otherParticipantIds.where((id) => id != myId).toList();
    if (others.isEmpty) return MessageStatus.sent;

    if (others.any((id) => readBy.contains(id))) return MessageStatus.read;
    if (others.any((id) => deliveredTo.contains(id))) return MessageStatus.delivered;
    return MessageStatus.sent;
  }

  MessageModel copyWith({
    String? id,
    String? clientId,
    String? chatId,
    String? senderId,
    MessageType? type,
    String? content,
    String? mediaUrl,
    DateTime? sentAt,
    List<String>? deliveredTo,
    List<String>? readBy,
    bool? failed,
  }) {
    return MessageModel(
      id: id ?? this.id,
      clientId: clientId ?? this.clientId,
      chatId: chatId ?? this.chatId,
      senderId: senderId ?? this.senderId,
      type: type ?? this.type,
      content: content ?? this.content,
      mediaUrl: mediaUrl ?? this.mediaUrl,
      sentAt: sentAt ?? this.sentAt,
      deliveredTo: deliveredTo ?? this.deliveredTo,
      readBy: readBy ?? this.readBy,
      failed: failed ?? this.failed,
    );
  }

  Map<String, dynamic> toJson() => {
        '_id': id,
        'clientId': clientId,
        'chatId': chatId,
        'senderId': senderId,
        'type': messageTypeString,
        'content': content,
        'mediaUrl': mediaUrl,
        'sentAt': sentAt.toIso8601String(),
        'deliveredTo': deliveredTo,
        'readBy': readBy,
      };
}
