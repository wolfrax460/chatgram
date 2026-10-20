import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../models/chat_model.dart';
import 'message_ticks.dart';
import 'user_avatar.dart';

/// One row in the chat list.
class ChatTile extends StatelessWidget {
  const ChatTile({
    super.key,
    required this.chat,
    required this.currentUserId,
    required this.selected,
    required this.onTap,
    this.isTyping = false,
  });

  final ChatModel chat;
  final String? currentUserId;
  final bool selected;
  final VoidCallback onTap;
  final bool isTyping;

  @override
  Widget build(BuildContext context) {
    final title = chat.displayTitle(currentUserId);
    final last = chat.lastMessage;

    return Material(
      color: selected
          ? (context.isDark ? const Color(0xFF2A3942) : const Color(0xFFF0F2F5))
          : Colors.transparent,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              UserAvatar(
                imageUrl: chat.avatarFor(currentUserId),
                initials: chat.initialsFor(currentUserId),
                size: 50,
                showPresence: chat.isDirect,
                isOnline: chat.isOnlineFor(currentUserId),
                colorSeed: chat.id,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 16.5,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          _formatTimestamp(chat.activityAt),
                          style: TextStyle(
                            fontSize: 12,
                            color: chat.unreadCount > 0
                                ? AppColors.green
                                : Theme.of(context).textTheme.bodySmall?.color,
                            fontWeight:
                                chat.unreadCount > 0 ? FontWeight.w600 : FontWeight.normal,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        if (isTyping)
                          const Expanded(
                            child: Text(
                              'typing…',
                              style: TextStyle(
                                color: AppColors.green,
                                fontStyle: FontStyle.italic,
                                fontSize: 14,
                              ),
                            ),
                          )
                        else ...[
                          if (last != null && last.senderId == currentUserId)
                            Padding(
                              padding: const EdgeInsets.only(right: 4),
                              child: MessageTicks(
                                status: last.statusFor(currentUserId, chat.participantIds),
                                size: 16,
                              ),
                            ),
                          Expanded(
                            child: Text(
                              _preview(last?.content, chat),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14,
                                color: Theme.of(context).textTheme.bodySmall?.color,
                              ),
                            ),
                          ),
                        ],
                        if (chat.unreadCount > 0) ...[
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            constraints: const BoxConstraints(minWidth: 20),
                            decoration: const BoxDecoration(
                              color: AppColors.green,
                              borderRadius: BorderRadius.all(Radius.circular(11)),
                            ),
                            child: Text(
                              chat.unreadCount > 99 ? '99+' : '${chat.unreadCount}',
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 11.5,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _preview(String? content, ChatModel chat) {
    final text = (content ?? '').trim();
    if (text.isNotEmpty) return text;
    final type = chat.lastMessage?.type;
    switch (type?.name) {
      case 'image':
        return '📷 Photo';
      case 'video':
        return '🎥 Video';
      case 'audio':
        return '🎤 Voice message';
      case 'file':
        return '📄 Document';
      default:
        return 'Tap to start chatting';
    }
  }

  static String _formatTimestamp(DateTime time) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final that = DateTime(time.year, time.month, time.day);
    final diff = today.difference(that).inDays;

    if (diff == 0) return DateFormat.jm().format(time);
    if (diff == 1) return 'Yesterday';
    if (diff < 7) return DateFormat.E().format(time);
    if (time.year == now.year) return DateFormat.MMMd().format(time);
    return DateFormat.yMd().format(time);
  }
}
