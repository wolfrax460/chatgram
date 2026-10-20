import 'package:flutter/foundation.dart';

import '../../server_config.dart';
import 'message_model.dart';
import 'user_model.dart';

class ChatModel {
  final String id;
  final String type; // 'direct' | 'group'
  final List<UserModel> participants;
  final String? groupName;
  final String groupAvatar;
  final List<String> adminIds;
  final DateTime createdAt;
  final DateTime updatedAt;
  final MessageModel? lastMessage;
  final int unreadCount;

  ChatModel({
    required this.id,
    required this.type,
    required this.participants,
    this.groupName,
    this.groupAvatar = '',
    required this.adminIds,
    required this.createdAt,
    required this.updatedAt,
    this.lastMessage,
    this.unreadCount = 0,
  });

  factory ChatModel.fromJson(Map<String, dynamic> json) {
    final rawParticipants = json['participants'] ?? json['participantIds'] ?? [];
    final participants = <UserModel>[];
    for (final p in (rawParticipants as List)) {
      if (p is Map) {
        participants.add(UserModel.fromJson(Map<String, dynamic>.from(p)));
      } else if (p != null) {
        // Un-populated ObjectId strings: keep a placeholder so ids survive.
        final id = p.toString();
        participants.add(UserModel(
          id: id,
          displayName: '',
          avatarUrl: '',
          isOnline: false,
          createdAt: DateTime.now(),
          updatedAt: DateTime.now(),
        ));
      }
    }

    MessageModel? lastMessage;
    final rawLast = json['lastMessage'] ?? json['lastMessageId'];
    if (rawLast is Map) {
      lastMessage = MessageModel.fromJson(Map<String, dynamic>.from(rawLast));
    }

    final rawAdmins = json['groupAdmins'] ?? json['adminIds'] ?? [];

    return ChatModel(
      id: (json['_id'] ?? json['id'] ?? '').toString(),
      type: (json['type'] ?? 'direct').toString(),
      participants: participants,
      groupName: json['groupName']?.toString(),
      groupAvatar: (json['groupAvatar'] ?? '').toString(),
      adminIds: (rawAdmins as List)
          .map((e) => e is Map ? (e['_id'] ?? '').toString() : e.toString())
          .where((e) => e.isNotEmpty)
          .toList(),
      createdAt: _parseDate(json['createdAt']) ?? DateTime.now(),
      updatedAt: _parseDate(json['updatedAt']) ?? DateTime.now(),
      lastMessage: lastMessage,
      unreadCount: (json['unreadCount'] as num?)?.toInt() ?? 0,
    );
  }

  static DateTime? _parseDate(dynamic value) {
    if (value == null) return null;
    if (value is DateTime) return value;
    return DateTime.tryParse(value.toString())?.toLocal();
  }

  bool get isGroup => type == 'group';
  bool get isDirect => type == 'direct';

  List<String> get participantIds => participants.map((p) => p.id).toList();

  /// The other person in a 1:1 chat.
  UserModel? otherParticipant(String? currentUserId) {
    for (final p in participants) {
      if (p.id != currentUserId) return p;
    }
    return participants.isEmpty ? null : participants.first;
  }

  String displayTitle(String? currentUserId) {
    if (isGroup) {
      return (groupName?.trim().isNotEmpty ?? false) ? groupName! : 'Group';
    }
    final other = otherParticipant(currentUserId);
    final name = other?.displayName ?? '';
    return name.isNotEmpty ? name : 'Chat';
  }

  String get resolvedGroupAvatar => ServerConfig.resolveMedia(groupAvatar);

  /// Avatar URL for a direct chat, or the group avatar.
  String avatarFor(String? currentUserId) {
    if (isGroup) return resolvedGroupAvatar;
    return otherParticipant(currentUserId)?.resolvedAvatarUrl ?? '';
  }

  String initialsFor(String? currentUserId) {
    if (isGroup) {
      final name = (groupName ?? '').trim();
      return name.isEmpty ? 'G' : name.substring(0, 1).toUpperCase();
    }
    return otherParticipant(currentUserId)?.initials ?? '?';
  }

  bool isOnlineFor(String? currentUserId) {
    if (isGroup) return false;
    return otherParticipant(currentUserId)?.isOnline ?? false;
  }

  DateTime get activityAt => lastMessage?.sentAt ?? updatedAt;

  Map<String, dynamic> toJson() => {
        '_id': id,
        'type': type,
        'participants': participants.map((p) => p.toJson()).toList(),
        'groupName': groupName,
        'groupAvatar': groupAvatar,
        'groupAdmins': adminIds,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'lastMessage': lastMessage?.toJson(),
        'unreadCount': unreadCount,
      };

  ChatModel copyWith({
    String? id,
    String? type,
    List<UserModel>? participants,
    String? groupName,
    String? groupAvatar,
    List<String>? adminIds,
    DateTime? createdAt,
    DateTime? updatedAt,
    MessageModel? lastMessage,
    int? unreadCount,
  }) {
    return ChatModel(
      id: id ?? this.id,
      type: type ?? this.type,
      participants: participants ?? this.participants,
      groupName: groupName ?? this.groupName,
      groupAvatar: groupAvatar ?? this.groupAvatar,
      adminIds: adminIds ?? this.adminIds,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      lastMessage: lastMessage ?? this.lastMessage,
      unreadCount: unreadCount ?? this.unreadCount,
    );
  }

  /// Lightweight equality used to avoid redundant rebuilds.
  @override
  bool operator ==(Object other) =>
      other is ChatModel &&
      other.id == id &&
      other.unreadCount == unreadCount &&
      other.lastMessage?.id == lastMessage?.id &&
      other.updatedAt == updatedAt;

  @override
  int get hashCode => Object.hash(id, unreadCount, lastMessage?.id, updatedAt);
}

/// Kept for callers that only need ids.
List<String> participantIdsOf(ChatModel chat) => chat.participantIds;

@visibleForTesting
String debugChatTitle(ChatModel chat, String? myId) => chat.displayTitle(myId);
