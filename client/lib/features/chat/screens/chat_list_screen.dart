import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/theme.dart';
import '../../../shared/widgets/add_contact_sheet.dart';
import '../../../shared/widgets/chat_tile.dart';
import '../../../shared/widgets/empty_state.dart';
import '../../../shared/widgets/new_chat_sheet.dart';
import '../../auth/services/auth_service.dart';
import '../../settings/services/settings_service.dart';
import '../services/chat_service.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// The conversation list. Used standalone on phones (as a tab) and embedded in
/// the wide three-pane layout on desktop/web.
class ChatListPane extends StatefulWidget {
  const ChatListPane({super.key, this.selectedChatId, this.onChatSelected});

  final String? selectedChatId;
  final ValueChanged<String>? onChatSelected;

  @override
  State<ChatListPane> createState() => _ChatListPaneState();
}

class _ChatListPaneState extends State<ChatListPane> {
  final TextEditingController _searchController = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final chatService = context.watch<ChatService>();
    final myId = auth.currentUser?.id;

    var chats = chatService.chats;
    if (_query.trim().isNotEmpty) {
      final q = _query.trim().toLowerCase();
      chats = chats
          .where((c) =>
              c.displayTitle(myId).toLowerCase().contains(q) ||
              (c.lastMessage?.content ?? '').toLowerCase().contains(q))
          .toList();
    }

    return Column(
      children: [
        _searchBar(context, chatService),
        Expanded(
          child: Builder(
            builder: (context) {
              if (chatService.isLoadingChats && chatService.chats.isEmpty) {
                return const Center(child: CircularProgressIndicator());
              }

              if (chats.isEmpty) {
                return RefreshIndicator(
                  onRefresh: () => chatService.loadChats(),
                  child: ListView(
                    children: [
                      SizedBox(height: MediaQuery.sizeOf(context).height * 0.12),
                      EmptyState(
                        icon: AppIcons.chats,
                        title: _query.isEmpty
                            ? 'No conversations yet'
                            : 'No matches for "$_query"',
                        message: _query.isEmpty
                            ? 'Start chatting with someone from your contacts.'
                            : null,
                        actionLabel: _query.isEmpty ? 'New chat' : null,
                        onAction: _query.isEmpty ? () => _startNewChat(context) : null,
                      ),
                    ],
                  ),
                );
              }

              return RefreshIndicator(
                onRefresh: () => chatService.loadChats(),
                child: ListView.separated(
                  padding: const EdgeInsets.only(bottom: 80),
                  itemCount: chats.length,
                  separatorBuilder: (_, __) => const Divider(height: 1, indent: 74),
                  itemBuilder: (context, index) {
                    final chat = chats[index];
                    return ChatTile(
                      chat: chat,
                      currentUserId: myId,
                      selected: chat.id == widget.selectedChatId,
                      isTyping: chatService.isOtherTyping(chat.id),
                      onTap: () => _openChat(context, chat.id),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _searchBar(BuildContext context, ChatService chatService) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
      child: TextField(
        controller: _searchController,
        onChanged: (value) => setState(() => _query = value),
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: 'Search or start a new chat',
          prefixIcon: const FaIcon(AppIcons.search, size: 20),
          isDense: true,
          fillColor: context.isDark ? const Color(0xFF202C33) : Colors.white,
          suffixIcon: _query.isNotEmpty
              ? IconButton(
                  icon: const FaIcon(AppIcons.close, size: 18),
                  onPressed: () {
                    _searchController.clear();
                    setState(() => _query = '');
                  },
                )
              : null,
          contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(24),
            borderSide: BorderSide.none,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(24),
            borderSide: BorderSide.none,
          ),
        ),
      ),
    );
  }

  void _openChat(BuildContext context, String chatId) {
    final onSelected = widget.onChatSelected;
    if (onSelected != null) {
      onSelected(chatId);
    } else {
      Navigator.of(context).pushNamed('/chat/$chatId');
    }
  }

  Future<void> _startNewChat(BuildContext context) async {
    final chatId = await showNewChatSheet(context);
    if (chatId != null && context.mounted) {
      _openChat(context, chatId);
    }
  }
}

/// Standalone page wrapper (phone/tablet tab). When [onChatSelected] is given
/// the screen is embedded in the wide split layout and does not push routes.
class ChatListScreen extends StatelessWidget {
  const ChatListScreen({
    super.key,
    this.selectedChatId,
    this.onChatSelected,
    this.showFab = true,
  });

  final String? selectedChatId;
  final ValueChanged<String>? onChatSelected;
  final bool showFab;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        // The Chatgram mark sits *with* the wordmark, rather than floating on
        // its own like a separate navigation tab.
        title: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: AppColors.brand600,
                borderRadius: BorderRadius.circular(9),
              ),
              child: const FaIcon(AppIcons.chat, size: 18, color: Colors.white),
            ),
            const SizedBox(width: 10),
            const Text('Chatgram'),
          ],
        ),
        actions: [
          // Quick light / dark / system toggle, so the theme is one tap away
          // instead of buried in Settings.
          Builder(
            builder: (context) {
              final settings = context.watch<SettingsService>();
              final mode = settings.themeMode;
              final icon = switch (mode) {
                ThemeMode.light => AppIcons.sun,
                ThemeMode.dark => AppIcons.moon,
                ThemeMode.system => AppIcons.theme,
              };
              final label = switch (mode) {
                ThemeMode.light => 'Light theme',
                ThemeMode.dark => 'Dark theme',
                ThemeMode.system => 'System theme',
              };
              return IconButton(
                tooltip: '$label — tap to change',
                icon: FaIcon(icon),
                onPressed: () => context.read<SettingsService>().cycleThemeMode(),
              );
            },
          ),
          // Find someone to chat with, straight from the messages tab.
          IconButton(
            tooltip: 'Search people to chat with',
            icon: const FaIcon(AppIcons.search),
            onPressed: () => showAddContactSheet(context),
          ),
          IconButton(
            tooltip: 'Refresh',
            icon: const FaIcon(AppIcons.refresh),
            onPressed: () => context.read<ChatService>().loadChats(),
          ),
        ],
      ),
      body: ChatListPane(
        selectedChatId: selectedChatId,
        onChatSelected: onChatSelected,
      ),
      floatingActionButton: !showFab
          ? null
          : FloatingActionButton(
              tooltip: 'New chat',
              onPressed: () async {
                final chatId = await showNewChatSheet(context);
                if (chatId != null && context.mounted) {
                  Navigator.of(context).pushNamed('/chat/$chatId');
                }
              },
              child: const FaIcon(AppIcons.chat),
            ),
    );
  }
}
