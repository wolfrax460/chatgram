import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../features/auth/services/auth_service.dart';
import '../../features/chat/services/chat_service.dart';
import '../../features/contacts/services/contacts_service.dart';
import '../models/user_model.dart';
import 'user_avatar.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Bottom sheet for starting a 1:1 chat or creating a group.
/// Resolves to the id of the chat to open, or null when dismissed.
///
/// Set [startInGroupMode] to open straight into "New group" (used by the
/// Groups tab).
Future<String?> showNewChatSheet(BuildContext context, {bool startInGroupMode = false}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _NewChatSheet(startInGroupMode: startInGroupMode),
  );
}

class _NewChatSheet extends StatefulWidget {
  const _NewChatSheet({this.startInGroupMode = false});

  final bool startInGroupMode;

  @override
  State<_NewChatSheet> createState() => _NewChatSheetState();
}

class _NewChatSheetState extends State<_NewChatSheet> {
  final TextEditingController _search = TextEditingController();
  final TextEditingController _groupName = TextEditingController();
  final Set<String> _selected = {};

  bool _groupMode = false;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _groupMode = widget.startInGroupMode;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ContactsService>().loadContacts();
    });
  }

  @override
  void dispose() {
    _search.dispose();
    _groupName.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final contactsService = context.watch<ContactsService>();
    final myId = context.watch<AuthService>().currentUserId;

    final contacts = contactsService.contacts
        .where((c) => c.id != myId)
        .where((c) {
      final q = _search.text.trim().toLowerCase();
      if (q.isEmpty) return true;
      return c.displayName.toLowerCase().contains(q) ||
          (c.handle).toLowerCase().contains(q);
    }).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Column(
          children: [
            _header(context),
            if (_groupMode) _groupNameField(context),
            if (_error != null)
              Container(
                width: double.infinity,
                color: Theme.of(context).colorScheme.errorContainer,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
                ),
              ),
            _searchField(context),
            const Divider(height: 1),
            Expanded(
              child: contactsService.isLoading && contacts.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : contacts.isEmpty
                      ? const Center(child: Text('No contacts found'))
                      : ListView.builder(
                          controller: scrollController,
                          itemCount: contacts.length,
                          itemBuilder: (context, index) {
                            final contact = contacts[index];
                            return _contactTile(context, contact);
                          },
                        ),
            ),
            _footer(context),
          ],
        );
      },
    );
  }

  Widget _header(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 4),
      child: Row(
        children: [
          if (_groupMode)
            IconButton(
              icon: const FaIcon(AppIcons.back),
              onPressed: () => setState(() {
                _groupMode = false;
                _selected.clear();
                _error = null;
              }),
            ),
          Expanded(
            child: Text(
              _groupMode ? 'New group' : 'New chat',
              style: Theme.of(context)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
          ),
          if (!_groupMode)
            TextButton.icon(
              onPressed: () => setState(() => _groupMode = true),
              icon: const FaIcon(AppIcons.personAdd, size: 18),
              label: const Text('Group'),
            ),
          IconButton(
            icon: const FaIcon(AppIcons.close),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ],
      ),
    );
  }

  Widget _groupNameField(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: TextField(
        controller: _groupName,
        decoration: const InputDecoration(
          labelText: 'Group name',
          prefixIcon: FaIcon(AppIcons.badge),
        ),
      ),
    );
  }

  Widget _searchField(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: TextField(
        controller: _search,
        onChanged: (_) => setState(() {}),
        decoration: const InputDecoration(
          hintText: 'Search contacts',
          prefixIcon: FaIcon(AppIcons.search, size: 20),
          isDense: true,
        ),
      ),
    );
  }

  Widget _contactTile(BuildContext context, UserModel contact) {
    final selected = _selected.contains(contact.id);

    return ListTile(
      leading: UserAvatar(
        imageUrl: contact.resolvedAvatarUrl,
        initials: contact.initials,
        size: 44,
        showPresence: true,
        isOnline: contact.isOnline,
        colorSeed: contact.id,
      ),
      title: Text(contact.displayName.isEmpty ? 'Unknown' : contact.displayName),
      subtitle: Text(contact.handle),
      trailing: _groupMode
          ? Checkbox(
              value: selected,
              onChanged: (_) => _toggle(contact.id),
            )
          : null,
      onTap: _groupMode ? () => _toggle(contact.id) : () => _startDirect(contact.id),
    );
  }

  void _toggle(String id) {
    setState(() {
      if (_selected.contains(id)) {
        _selected.remove(id);
      } else {
        _selected.add(id);
      }
    });
  }

  Widget _footer(BuildContext context) {
    if (!_groupMode) return const SizedBox(height: 12);

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
        child: Row(
          children: [
            Expanded(
              child: Text(
                '${_selected.length} selected',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
            FilledButton.icon(
              onPressed: _busy || _selected.isEmpty ? null : _createGroup,
              icon: _busy
                  ? const SizedBox(
                      width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const FaIcon(AppIcons.check),
              label: const Text('Create group'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _startDirect(String participantId) async {
    setState(() {
      _busy = true;
      _error = null;
    });

    final chatId = await context.read<ChatService>().openDirectChat(participantId);
    if (!mounted) return;

    if (chatId == null) {
      setState(() {
        _busy = false;
        _error = context.read<ChatService>().errorMessage ?? 'Could not start the chat';
      });
      return;
    }
    Navigator.of(context).pop(chatId);
  }

  Future<void> _createGroup() async {
    final name = _groupName.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Please enter a group name');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    final chatId = await context.read<ChatService>().createGroup(
          name: name,
          participantIds: _selected.toList(),
        );
    if (!mounted) return;

    if (chatId == null) {
      setState(() {
        _busy = false;
        _error = context.read<ChatService>().errorMessage ?? 'Could not create the group';
      });
      return;
    }
    Navigator.of(context).pop(chatId);
  }
}
