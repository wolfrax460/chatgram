import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/theme.dart';
import '../../../shared/models/user_model.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/services/auth_service.dart';
import '../../chat/services/chat_service.dart';
import '../../contacts/services/contacts_service.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Someone's profile — opened by tapping a contact or a chat header.
class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key, required this.userId});

  final String userId;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  UserModel? _user;
  bool _loading = true;
  bool _startingChat = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final user = await context.read<ContactsService>().fetchUser(widget.userId);
    if (!mounted) return;
    setState(() {
      _user = user;
      _loading = false;
    });
  }

  Future<void> _message() async {
    final user = _user;
    if (user == null) return;

    setState(() => _startingChat = true);
    final chatService = context.read<ChatService>();
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final chatId = await chatService.openDirectChat(user.id);
    if (!mounted) return;
    setState(() => _startingChat = false);

    if (chatId == null) {
      messenger.showSnackBar(
        SnackBar(content: Text(chatService.errorMessage ?? 'Could not open the chat')),
      );
      return;
    }
    navigator.pushNamed('/chat/$chatId');
  }

  @override
  Widget build(BuildContext context) {
    final myId = context.watch<AuthService>().currentUserId;
    final isSelf = myId == widget.userId;
    final user = _user;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Contact info'),
        actions: [
          if (user != null)
            IconButton(
              tooltip: 'Refresh',
              icon: const FaIcon(AppIcons.refresh),
              onPressed: _load,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : user == null
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'This contact could not be loaded.\n\nCheck that the server is reachable.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView(
                  children: [
                    const SizedBox(height: 20),
                    Center(
                      child: UserAvatar(
                        imageUrl: user.resolvedAvatarUrl,
                        initials: user.initials,
                        size: 132,
                        colorSeed: user.id,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Center(
                      child: Text(
                        user.displayName.isEmpty ? 'Unknown' : user.displayName,
                        style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Center(
                      child: Text(
                        user.isOnline ? 'online' : _lastSeenLabel(user.lastSeen),
                        style: TextStyle(
                          fontSize: 14,
                          color: user.isOnline
                              ? AppColors.green
                              : Theme.of(context).textTheme.bodySmall?.color,
                          fontWeight: user.isOnline ? FontWeight.w600 : FontWeight.normal,
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),

                    if (!isSelf)
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: Row(
                          children: [
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: _startingChat ? null : _message,
                                style: FilledButton.styleFrom(
                                  backgroundColor: AppColors.green,
                                  minimumSize: const Size.fromHeight(48),
                                ),
                                icon: _startingChat
                                    ? const SizedBox(
                                        width: 16,
                                        height: 16,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Colors.white,
                                        ),
                                      )
                                    : const FaIcon(AppIcons.chat),
                                label: const Text('Message'),
                              ),
                            ),
                          ],
                        ),
                      ),
                    const SizedBox(height: 24),

                    if (user.about?.trim().isNotEmpty ?? false)
                      _InfoTile(
                        icon: AppIcons.info,
                        label: 'About',
                        value: user.about!,
                      ),
                    if (user.phone?.isNotEmpty ?? false)
                      _InfoTile(
                        icon: AppIcons.phone,
                        label: 'Phone',
                        value: user.phone!,
                        selectable: true,
                      ),
                    if (user.email?.isNotEmpty ?? false)
                      _InfoTile(
                        icon: AppIcons.email,
                        label: 'Email',
                        value: user.email!,
                        selectable: true,
                      ),
                    _InfoTile(
                      icon: AppIcons.clock,
                      label: 'Last seen',
                      value: _lastSeenLabel(user.lastSeen),
                    ),
                    const SizedBox(height: 32),
                  ],
                ),
    );
  }

  static String _lastSeenLabel(DateTime? lastSeen) {
    if (lastSeen == null) return 'last seen recently';
    final diff = DateTime.now().difference(lastSeen);
    if (diff.inMinutes < 1) return 'last seen just now';
    if (diff.inMinutes < 60) return 'last seen ${diff.inMinutes} minutes ago';
    if (diff.inHours < 24) return 'last seen ${diff.inHours} hours ago';
    if (diff.inDays == 1) return 'last seen yesterday';
    return 'last seen ${diff.inDays} days ago';
  }
}

class _InfoTile extends StatelessWidget {
  const _InfoTile({
    required this.icon,
    required this.label,
    required this.value,
    this.selectable = false,
  });

  final FaIconData icon;
  final String label;
  final String value;
  final bool selectable;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: FaIcon(icon),
      title: Text(label, style: const TextStyle(fontSize: 13)),
      subtitle: selectable
          ? SelectableText(
              value,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
            )
          : Text(
              value,
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w500),
            ),
    );
  }
}
