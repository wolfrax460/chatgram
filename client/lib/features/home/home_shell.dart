import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme.dart';
import '../../features/chat/screens/chat_detail_screen.dart';
import '../../features/chat/screens/chat_list_screen.dart';
import '../../features/chat/screens/groups_screen.dart';
import '../../features/chat/services/chat_service.dart';
import '../../features/contacts/screens/contacts_screen.dart';
import '../../features/contacts/services/contacts_service.dart';
import '../../features/settings/screens/settings_screen.dart';
import '../../features/settings/services/privacy_service.dart';
import '../../features/settings/services/settings_service.dart';
import '../../features/settings/services/version_service.dart';
import '../../features/status/screens/status_screen.dart';
import '../../features/status/services/status_service.dart';
import '../../shared/widgets/responsive.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Root authenticated screen.
///
/// * Phones / narrow windows: bottom navigation with Chats, Status, Contacts,
///   Settings — tapping a chat pushes the conversation.
/// * Desktop / wide windows: WhatsApp-Web style three panes (nav rail, chat
///   list, conversation) with the list and thread side by side.
class HomeShell extends StatefulWidget {
  const HomeShell({super.key});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _tabIndex = 0;
  String? _selectedChatId;
  bool _bootstrapped = false;
  bool _updateDialogShown = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _bootstrap());
  }

  Future<void> _bootstrap() async {
    if (_bootstrapped) return;
    _bootstrapped = true;

    if (!mounted) return;
    final chatService = context.read<ChatService>();

    // Realtime first so no message is missed while the lists load.
    chatService.ensureSocket();

    await Future.wait([
      chatService.loadChats(),
      chatService.loadGroups(),
      context.read<ContactsService>().loadContacts(),
      context.read<StatusService>().loadStatuses(),
      context.read<SettingsService>().loadSettings(),
      context.read<PrivacyService>().load(),
      context.read<VersionService>().check(),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    final isWide = Breakpoints.isWide(context);

    // A blocking prompt when this build is too old to use; a dismissible
    // banner when a newer release simply exists.
    final version = context.watch<VersionService>();
    if (version.updateRequired && !_updateDialogShown) {
      _updateDialogShown = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _showRequiredUpdateDialog(context);
      });
    }

    final body = isWide ? _wideScaffold(context) : _narrowScaffold(context);

    if (!version.updateAvailable || version.updateRequired) return body;

    return Column(
      children: [
        _UpdateBanner(version: version),
        Expanded(child: body),
      ],
    );
  }

  void _showRequiredUpdateDialog(BuildContext context) {
    final version = context.read<VersionService>();

    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => PopScope(
        canPop: false,
        child: AlertDialog(
          icon: const FaIcon(AppIcons.update, size: 32),
          title: const Text('Update required'),
          content: Text(
            'This version of Chatgram (${version.appVersion}) is no longer '
            'supported. Please install version ${version.latestVersion ?? ''} '
            'to keep chatting.'
            '${version.releaseNotes != null && version.releaseNotes!.isNotEmpty ? '\n\n${version.releaseNotes}' : ''}',
          ),
          actions: [
            if (version.updateUrl != null && version.updateUrl!.isNotEmpty)
              FilledButton.icon(
                onPressed: () => launchUrl(
                  Uri.parse(version.updateUrl!),
                  mode: LaunchMode.externalApplication,
                ),
                icon: const FaIcon(AppIcons.download),
                label: const Text('Update now'),
              ),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------ wide layout
  Widget _wideScaffold(BuildContext context) {    return Scaffold(
      body: Row(
        children: [
          _rail(context),
          const VerticalDivider(width: 1),
          Expanded(child: _pane(context)),
        ],
      ),
    );
  }

  Widget _rail(BuildContext context) {
    final unread = context.watch<ChatService>().totalUnread;
    final hasUnseenStatuses = context.watch<StatusService>().hasUnseen;

    return NavigationRail(
      selectedIndex: _tabIndex,
      onDestinationSelected: (index) => setState(() => _tabIndex = index),
      labelType: NavigationRailLabelType.all,
      // No leading brand icon here: the Chatgram mark now sits with the
      // wordmark in the chat list's app bar, so a second one just looked like
      // a stray navigation tab.
      destinations: [
        NavigationRailDestination(
          icon: Badge(
            isLabelVisible: unread > 0,
            label: Text('$unread'),
            child: const FaIcon(AppIcons.chat),
          ),
          selectedIcon: Badge(
            isLabelVisible: unread > 0,
            label: Text('$unread'),
            child: const FaIcon(AppIcons.chatFilled),
          ),
          label: const Text('Chats'),
        ),
        // No badge on Groups: it showed the *total* group count, which is not a
        // notification and read like a stale number.
        const NavigationRailDestination(
          icon: FaIcon(AppIcons.groups),
          selectedIcon: FaIcon(AppIcons.groups),
          label: Text('Groups'),
        ),
        NavigationRailDestination(
          // A dot rather than a number: statuses are "something new to watch",
          // and it clears once every one has been viewed.
          icon: _StatusIcon(showDot: hasUnseenStatuses),
          selectedIcon: _StatusIcon(showDot: hasUnseenStatuses, filled: true),
          label: const Text('Status'),
        ),
        const NavigationRailDestination(
          icon: FaIcon(AppIcons.contacts),
          selectedIcon: FaIcon(AppIcons.contacts),
          label: Text('Contacts'),
        ),
        const NavigationRailDestination(
          icon: FaIcon(AppIcons.settings),
          selectedIcon: FaIcon(AppIcons.settings),
          label: Text('Settings'),
        ),
      ],
    );
  }

  Widget _pane(BuildContext context) {
    if (_tabIndex != 0) {
      return KeyedSubtree(
        key: ValueKey('tab-$_tabIndex'),
        child: _tabPage(_tabIndex),
      );
    }

    return Row(
      children: [
        SizedBox(
          // Scales with the window instead of a fixed 380px, so a 900px laptop
          // and a 1440p monitor both get a sensible list-to-chat split.
          width: Breakpoints.chatListPaneWidth(context),
          child: ChatListScreen(
            selectedChatId: _selectedChatId,
            onChatSelected: (id) => setState(() => _selectedChatId = id),
            showFab: false,
          ),
        ),
        const VerticalDivider(width: 1),
        Expanded(
          child: _selectedChatId == null
              ? const _NoConversationSelected()
              : ChatDetailPane(
                  key: ValueKey(_selectedChatId),
                  chatId: _selectedChatId!,
                ),
        ),
      ],
    );
  }

  // ----------------------------------------------------------- narrow layout
  Widget _narrowScaffold(BuildContext context) {
    final unread = context.watch<ChatService>().totalUnread;
    final hasUnseenStatuses = context.watch<StatusService>().hasUnseen;

    return Scaffold(
      body: KeyedSubtree(
        key: ValueKey('tab-$_tabIndex'),
        child: _tabPage(_tabIndex),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tabIndex,
        onDestinationSelected: (index) => setState(() => _tabIndex = index),
        destinations: [
          NavigationDestination(
            icon: Badge(
              isLabelVisible: unread > 0,
              label: Text('$unread'),
              child: const FaIcon(AppIcons.chat),
            ),
            selectedIcon: const FaIcon(AppIcons.chatFilled),
            label: 'Chats',
          ),
          const NavigationDestination(
            icon: FaIcon(AppIcons.groups),
            selectedIcon: FaIcon(AppIcons.groups),
            label: 'Groups',
          ),
          NavigationDestination(
            // Green dot while any contact update is unwatched; gone once seen.
            icon: _StatusIcon(showDot: hasUnseenStatuses),
            selectedIcon: _StatusIcon(showDot: hasUnseenStatuses, filled: true),
            label: 'Status',
          ),
          const NavigationDestination(
            icon: FaIcon(AppIcons.contacts),
            selectedIcon: FaIcon(AppIcons.contacts),
            label: 'Contacts',
          ),
          const NavigationDestination(
            icon: FaIcon(AppIcons.settings),
            selectedIcon: FaIcon(AppIcons.settings),
            label: 'Settings',
          ),
        ],
      ),
    );
  }

  Widget _tabPage(int index) {
    switch (index) {
      case 1:
        return const GroupsScreen();
      case 2:
        return const StatusScreen();
      case 3:
        return const ContactsScreen();
      case 4:
        return const SettingsScreen();
      case 0:
      default:
        return const ChatListScreen();
    }
  }
}

class _NoConversationSelected extends StatelessWidget {
  const _NoConversationSelected();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: context.isDark ? const Color(0xFF222E35) : const Color(0xFFF0F2F5),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const FaIcon(AppIcons.chats, size: 110, color: Color(0xFF8696A0)),
              const SizedBox(height: 20),
              Text(
                'Chatgram for Desktop',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 10),
              Text(
                'Select a conversation on the left to start messaging.',
                textAlign: TextAlign.center,
                style: Theme.of(context)
                    .textTheme
                    .bodyMedium
                    ?.copyWith(color: const Color(0xFF8696A0)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Slim "a new version is available" strip shown above the app.
class _UpdateBanner extends StatelessWidget {
  const _UpdateBanner({required this.version});

  final VersionService version;

  @override
  Widget build(BuildContext context) {
    final hasUrl = version.updateUrl != null && version.updateUrl!.isNotEmpty;

    return Material(
      color: AppColors.teal,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 6, 8),
          child: Row(
            children: [
              const FaIcon(AppIcons.download, color: Colors.white, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Chatgram ${version.latestVersion} is available '
                  '(you have ${version.appVersion}).',
                  style: const TextStyle(color: Colors.white, fontSize: 13.5),
                ),
              ),
              if (hasUrl)
                TextButton(
                  onPressed: () => launchUrl(
                    Uri.parse(version.updateUrl!),
                    mode: LaunchMode.externalApplication,
                  ),
                  style: TextButton.styleFrom(foregroundColor: Colors.white),
                  child: const Text('Update'),
                ),
              IconButton(
                tooltip: 'Dismiss',
                icon: const FaIcon(AppIcons.close, color: Colors.white, size: 18),
                onPressed: () => context.read<VersionService>().dismissBanner(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Status tab icon: a normal glyph, plus a small green dot when there are
/// unwatched updates. Deliberately not a number — statuses are not an inbox.
class _StatusIcon extends StatelessWidget {
  const _StatusIcon({required this.showDot, this.filled = false});

  final bool showDot;
  final bool filled;

  @override
  Widget build(BuildContext context) {
    final icon = FaIcon(filled ? AppIcons.status : AppIcons.statusRing);

    if (!showDot) return icon;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        icon,
        Positioned(
          right: -1,
          top: -1,
          child: Container(
            width: 9,
            height: 9,
            decoration: BoxDecoration(
              color: AppColors.green,
              shape: BoxShape.circle,
              border: Border.all(color: Theme.of(context).colorScheme.surface, width: 1.5),
            ),
          ),
        ),
      ],
    );
  }
}
