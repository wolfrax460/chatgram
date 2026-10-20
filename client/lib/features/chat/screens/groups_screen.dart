import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../../../core/theme.dart';
import '../../../shared/models/chat_model.dart';
import '../../../shared/widgets/empty_state.dart';
import '../../../shared/widgets/new_chat_sheet.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/services/auth_service.dart';
import '../services/chat_service.dart';
import 'group_info_screen.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// The Groups tab: every group you belong to, plus creating a new one.
class GroupsScreen extends StatefulWidget {
  const GroupsScreen({super.key});

  @override
  State<GroupsScreen> createState() => _GroupsScreenState();
}

class _GroupsScreenState extends State<GroupsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ChatService>().loadGroups();
    });
  }

  Future<void> _createGroup() async {
    final chatId = await showNewChatSheet(context, startInGroupMode: true);
    if (chatId == null || !mounted) return;
    await context.read<ChatService>().loadGroups();
    if (!mounted) return;
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => GroupInfoScreen(chatId: chatId)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final service = context.watch<ChatService>();
    final myId = context.watch<AuthService>().currentUserId;
    final groups = service.groups;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Groups'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const FaIcon(AppIcons.refresh),
            onPressed: () => context.read<ChatService>().loadGroups(),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => context.read<ChatService>().loadGroups(),
        child: Builder(
          builder: (context) {
            if (service.isLoadingGroups && groups.isEmpty) {
              return const Center(child: CircularProgressIndicator());
            }

            if (groups.isEmpty) {
              return ListView(
                children: [
                  SizedBox(height: MediaQuery.sizeOf(context).height * 0.12),
                  const EmptyState(
                    icon: AppIcons.groups,
                    title: 'No groups yet',
                    message:
                        'Create a group to chat with several people at once — '
                        'add photos, voice notes and status updates just like a '
                        'one-to-one chat.',
                  ),
                ],
              );
            }

            return ListView.separated(
              padding: const EdgeInsets.only(bottom: 90),
              itemCount: groups.length,
              separatorBuilder: (_, __) => const Divider(height: 1, indent: 76),
              itemBuilder: (context, index) => _groupTile(groups[index], myId),
            );
          },
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _createGroup,
        icon: const FaIcon(AppIcons.personAdd),
        label: const Text('New group'),
      ),
    );
  }

  Widget _groupTile(ChatModel group, String? myId) {
    final others = group.participants.where((p) => p.id != myId).toList();
    final names = others.map((p) => p.displayName).where((n) => n.isNotEmpty).toList();
    final preview = names.isEmpty
        ? '${group.participants.length} members'
        : names.take(3).join(', ') + (names.length > 3 ? ' +${names.length - 3}' : '');

    final last = group.lastMessage;

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
      leading: UserAvatar(
        imageUrl: group.resolvedGroupAvatar,
        initials: group.initialsFor(myId),
        size: 52,
        colorSeed: group.id,
      ),
      title: Row(
        children: [
          Expanded(
            child: Text(
              group.displayTitle(myId),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
            ),
          ),
          if (group.adminIds.contains(myId))
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.green.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: const Text(
                'Admin',
                style: TextStyle(
                  fontSize: 10.5,
                  color: AppColors.teal,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 2),
          Row(
            children: [
              const FaIcon(AppIcons.group, size: 13, color: Colors.grey),
              const SizedBox(width: 4),
              Text(
                '${group.participants.length} members',
                style: const TextStyle(fontSize: 12),
              ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            last == null
                ? preview
                : '${last.senderId == myId ? 'You: ' : ''}${_preview(last.content, last.type.name)}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 13.5,
              color: Theme.of(context).textTheme.bodySmall?.color,
            ),
          ),
        ],
      ),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            _formatTimestamp(last?.sentAt ?? group.updatedAt),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 6),
          if (group.unreadCount > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: const BoxDecoration(
                color: AppColors.green,
                borderRadius: BorderRadius.all(Radius.circular(11)),
              ),
              child: Text(
                '${group.unreadCount}',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
        ],
      ),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(builder: (_) => GroupInfoScreen(chatId: group.id)),
      ),
    );
  }

  static String _preview(String? content, String type) {
    final text = (content ?? '').trim();
    if (text.isNotEmpty) return text;
    switch (type) {
      case 'image':
        return '📷 Photo';
      case 'video':
        return '🎥 Video';
      case 'audio':
        return '🎤 Voice message';
      case 'file':
        return '📄 Document';
      default:
        return 'No messages yet';
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
    return DateFormat.MMMd().format(time);
  }
}
