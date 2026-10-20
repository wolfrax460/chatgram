import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../models/chat_model.dart';
import 'message_ticks.dart';
import 'user_avatar.dart';

/// One row in the chat list.
///
/// Interactive on desktop as well as touch: it reacts to hover, animates its
/// background between idle/hover/selected, and rings the avatar when there are
/// unread messages — so the list feels alive rather than static.
class ChatTile extends StatefulWidget {
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
  State<ChatTile> createState() => _ChatTileState();
}

class _ChatTileState extends State<ChatTile> {
  bool _hovering = false;

  @override
  Widget build(BuildContext context) {
    final chat = widget.chat;
    final currentUserId = widget.currentUserId;
    final selected = widget.selected;

    final title = chat.displayTitle(currentUserId);
    final last = chat.lastMessage;
    final unread = chat.unreadCount;

    final isDark = context.isDark;

    // Surfaces matching the web client's hover/active treatment.
    const idle = Colors.transparent;
    final hover = isDark ? const Color(0xFF1D2730) : const Color(0xFFF2F5F4);
    final active = isDark ? const Color(0xFF243039) : const Color(0xFFE7F3EF);

    final background = selected ? active : (_hovering ? hover : idle);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
      child: MouseRegion(
        onEnter: (_) => setState(() => _hovering = true),
        onExit: (_) => setState(() => _hovering = false),
        cursor: SystemMouseCursors.click,
        child: GestureDetector(
          onTap: widget.onTap,
          behavior: HitTestBehavior.opaque,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 140),
            curve: Curves.easeOut,
            decoration: BoxDecoration(
              color: background,
              borderRadius: BorderRadius.circular(14),
              border: selected
                  ? Border.all(
                      color: AppColors.brand600.withValues(alpha: 0.35),
                      width: 1,
                    )
                  : Border.all(color: Colors.transparent, width: 1),
            ),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 10),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                // Unread ring around the avatar, like the web client.
                AnimatedContainer(
                  duration: const Duration(milliseconds: 220),
                  padding: EdgeInsets.all(unread > 0 ? 2 : 0),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: unread > 0
                        ? const LinearGradient(
                            colors: [Color(0xFF25D366), AppColors.brand600],
                          )
                        : null,
                  ),
                  child: UserAvatar(
                    imageUrl: chat.avatarFor(currentUserId),
                    initials: chat.initialsFor(currentUserId),
                    size: 48,
                    showPresence: chat.isDirect,
                    isOnline: chat.isOnlineFor(currentUserId),
                    colorSeed: chat.id,
                  ),
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
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: unread > 0 ? FontWeight.w800 : FontWeight.w600,
                                letterSpacing: -0.2,
                              ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            _formatTimestamp(chat.activityAt),
                            style: TextStyle(
                              fontSize: 11.5,
                              color: unread > 0
                                  ? AppColors.brand600
                                  : Theme.of(context).textTheme.bodySmall?.color,
                              fontWeight:
                                  unread > 0 ? FontWeight.w700 : FontWeight.w400,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          if (widget.isTyping)
                            const Expanded(
                              child: Text(
                                'typing…',
                                style: TextStyle(
                                  color: AppColors.brand600,
                                  fontStyle: FontStyle.italic,
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            )
                          else ...[
                            if (last != null && last.senderId == currentUserId)
                              Padding(
                                padding: const EdgeInsets.only(right: 4),
                                child: MessageTicks(
                                  status: last.statusFor(
                                    currentUserId,
                                    chat.participantIds,
                                  ),
                                  size: 15,
                                ),
                              ),
                            Expanded(
                              child: Text(
                                _preview(last?.content, chat),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 13.5,
                                  height: 1.3,
                                  color: unread > 0
                                      ? (isDark ? AppColors.ink200 : AppColors.ink600)
                                      : Theme.of(context).textTheme.bodySmall?.color,
                                ),
                              ),
                            ),
                          ],
                          if (unread > 0) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 2.5,
                              ),
                              constraints: const BoxConstraints(minWidth: 21),
                              decoration: BoxDecoration(
                                color: AppColors.brand600,
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(
                                unread > 99 ? '99+' : '$unread',
                                textAlign: TextAlign.center,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w800,
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

    return DateFormat.MMMd().format(time);
  }
}
