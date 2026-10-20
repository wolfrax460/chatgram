import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/theme.dart';
import '../../../shared/models/chat_model.dart';
import '../../../shared/models/user_model.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/services/auth_service.dart';
import '../../contacts/services/contacts_service.dart';
import '../services/chat_service.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// View a group: who is in it, add or remove members, rename it, or leave.
class GroupInfoScreen extends StatefulWidget {
  const GroupInfoScreen({super.key, required this.chatId});

  final String chatId;

  @override
  State<GroupInfoScreen> createState() => _GroupInfoScreenState();
}

class _GroupInfoScreenState extends State<GroupInfoScreen> {
  ChatModel? _group;
  bool _loading = true;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final group = await context.read<ChatService>().fetchChat(widget.chatId);
    if (!mounted) return;
    setState(() {
      _group = group;
      _loading = false;
    });
  }

  bool get _isAdmin {
    final myId = context.read<AuthService>().currentUserId;
    return _group?.adminIds.contains(myId) ?? false;
  }

  Future<void> _addMembers() async {
    final group = _group;
    if (group == null) return;

    final myId = context.read<AuthService>().currentUserId;
    final contacts = context.read<ContactsService>();
    if (contacts.contacts.isEmpty) await contacts.loadContacts();

    final existing = group.participants.map((p) => p.id).toSet();
    if (!mounted) return;

    final selected = await showModalBottomSheet<List<String>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => _PickMembersSheet(
        title: 'Add members',
        candidates: contacts.contacts
            .where((c) => c.id != myId && !existing.contains(c.id))
            .toList(),
        initiallySelected: const {},
      ),
    );

    if (selected == null || selected.isEmpty || !mounted) return;

    setState(() => _busy = true);
    final service = context.read<ChatService>();
    final messenger = ScaffoldMessenger.of(context);

    final ok = await service.addGroupMembers(widget.chatId, selected);
    if (!mounted) return;
    setState(() => _busy = false);

    if (ok) {
      await _load();
      messenger.showSnackBar(
        SnackBar(content: Text('Added ${selected.length} member${selected.length == 1 ? '' : 's'}')),
      );
    } else {
      messenger.showSnackBar(
        SnackBar(content: Text(service.errorMessage ?? 'Could not add members')),
      );
    }
  }

  Future<void> _rename() async {
    final group = _group;
    if (group == null) return;

    final controller = TextEditingController(text: group.groupName ?? '');
    final name = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rename group'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(labelText: 'Group name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );
    controller.dispose();

    if (name == null || name.isEmpty || !mounted) return;

    setState(() => _busy = true);
    final service = context.read<ChatService>();
    final messenger = ScaffoldMessenger.of(context);
    final ok = await service.renameGroup(widget.chatId, name);
    if (!mounted) return;
    setState(() => _busy = false);

    if (ok) {
      await _load();
    } else {
      messenger.showSnackBar(
        SnackBar(content: Text(service.errorMessage ?? 'Could not rename the group')),
      );
    }
  }

  Future<void> _removeMember(UserModel member) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Remove ${member.displayName}?'),
        content: const Text('They will no longer receive messages from this group.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    final service = context.read<ChatService>();
    final ok = await service.removeGroupMember(widget.chatId, member.id);
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) await _load();
  }

  Future<void> _toggleAdmin(UserModel member) async {
    final group = _group;
    if (group == null) return;

    final isAdmin = group.adminIds.contains(member.id);
    setState(() => _busy = true);
    final service = context.read<ChatService>();
    final messenger = ScaffoldMessenger.of(context);

    final ok = await service.setGroupAdmin(widget.chatId, member.id, isAdmin: !isAdmin);
    if (!mounted) return;
    setState(() => _busy = false);

    if (ok) {
      await _load();
    } else {
      messenger.showSnackBar(
        SnackBar(content: Text(service.errorMessage ?? 'Could not change admin rights')),
      );
    }
  }

  Future<void> _leave() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Leave group?'),
        content: const Text('You will stop receiving messages from this group.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Leave'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final service = context.read<ChatService>();
    final navigator = Navigator.of(context);
    setState(() => _busy = true);
    final ok = await service.leaveGroup(widget.chatId);
    if (!mounted) return;
    setState(() => _busy = false);

    if (ok) {
      navigator.popUntil((route) => route.isFirst);
    }
  }

  @override
  Widget build(BuildContext context) {
    final myId = context.watch<AuthService>().currentUserId;
    final group = _group;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Group info'),
        actions: [
          if (_isAdmin && group != null)
            IconButton(
              tooltip: 'Rename',
              icon: const FaIcon(AppIcons.edit),
              onPressed: _busy ? null : _rename,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : group == null
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'This group could not be loaded.\n\nCheck that the server is reachable.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView(
                  children: [
                    const SizedBox(height: 20),
                    Center(
                      child: UserAvatar(
                        imageUrl: group.resolvedGroupAvatar,
                        initials: group.initialsFor(myId),
                        size: 120,
                        colorSeed: group.id,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Center(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 24),
                        child: Text(
                          group.displayTitle(myId),
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w600),
                        ),
                      ),
                    ),
                    const SizedBox(height: 6),
                    Center(
                      child: Text(
                        'Group · ${group.participants.length} members',
                        style: TextStyle(
                          fontSize: 14,
                          color: Theme.of(context).textTheme.bodySmall?.color,
                        ),
                      ),
                    ),
                    const SizedBox(height: 24),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: Row(
                        children: [
                          Expanded(
                            child: FilledButton.icon(
                              onPressed: _busy
                                  ? null
                                  : () => Navigator.of(context)
                                      .pushNamed('/chat/${widget.chatId}'),
                              style: FilledButton.styleFrom(
                                backgroundColor: AppColors.green,
                                minimumSize: const Size.fromHeight(46),
                              ),
                              icon: const FaIcon(AppIcons.chat),
                              label: const Text('Open chat'),
                            ),
                          ),
                          if (_isAdmin) ...[
                            const SizedBox(width: 10),
                            FilledButton.tonalIcon(
                              onPressed: _busy ? null : _addMembers,
                              style: FilledButton.styleFrom(
                                minimumSize: const Size.fromHeight(46),
                              ),
                              icon: const FaIcon(AppIcons.personAdd),
                              label: const Text('Add'),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    const Divider(height: 1),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
                      child: Text(
                        '${group.participants.length} MEMBERS',
                        style: const TextStyle(
                          fontSize: 11.5,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.5,
                        ),
                      ),
                    ),
                    ...group.participants.map((member) {
                      final isMe = member.id == myId;
                      final isAdmin = group.adminIds.contains(member.id);

                      return ListTile(
                        leading: UserAvatar(
                          imageUrl: member.resolvedAvatarUrl,
                          initials: member.initials,
                          size: 44,
                          showPresence: true,
                          isOnline: member.isOnline,
                          colorSeed: member.id,
                        ),
                        title: Row(
                          children: [
                            Flexible(
                              child: Text(
                                isMe ? 'You' : member.displayName,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (isAdmin) ...[
                              const SizedBox(width: 8),
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
                          ],
                        ),
                        subtitle: Text(member.handle),
                        trailing: (isMe || !_isAdmin)
                            ? null
                            : PopupMenuButton<String>(
                                onSelected: (value) {
                                  if (value == 'admin') _toggleAdmin(member);
                                  if (value == 'remove') _removeMember(member);
                                },
                                itemBuilder: (_) => [
                                  PopupMenuItem(
                                    value: 'admin',
                                    child: Text(isAdmin ? 'Dismiss as admin' : 'Make admin'),
                                  ),
                                  const PopupMenuItem(
                                    value: 'remove',
                                    child: Text('Remove from group'),
                                  ),
                                ],
                              ),
                        onTap: isMe
                            ? null
                            : () => Navigator.of(context).pushNamed('/user/${member.id}'),
                      );
                    }),
                    const SizedBox(height: 20),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: OutlinedButton.icon(
                        onPressed: _busy ? null : _leave,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: Theme.of(context).colorScheme.error,
                          minimumSize: const Size.fromHeight(48),
                        ),
                        icon: const FaIcon(AppIcons.logout),
                        label: const Text('Leave group'),
                      ),
                    ),
                    const SizedBox(height: 40),
                  ],
                ),
    );
  }
}

/// Reusable multi-select list of contacts.
class _PickMembersSheet extends StatefulWidget {
  const _PickMembersSheet({
    required this.title,
    required this.candidates,
    required this.initiallySelected,
  });

  final String title;
  final List<UserModel> candidates;
  final Set<String> initiallySelected;

  @override
  State<_PickMembersSheet> createState() => _PickMembersSheetState();
}

class _PickMembersSheetState extends State<_PickMembersSheet> {
  final TextEditingController _search = TextEditingController();
  late final Set<String> _selected = {...widget.initiallySelected};

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final query = _search.text.trim().toLowerCase();
    final list = widget.candidates.where((c) {
      if (query.isEmpty) return true;
      return c.displayName.toLowerCase().contains(query) ||
          c.handle.toLowerCase().contains(query);
    }).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.8,
      maxChildSize: 0.95,
      builder: (context, controller) => Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    widget.title,
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                Text('${_selected.length} selected'),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              controller: _search,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                hintText: 'Search contacts',
                prefixIcon: FaIcon(AppIcons.search, size: 20),
                isDense: true,
              ),
            ),
          ),
          const Divider(height: 1),
          Expanded(
            child: list.isEmpty
                ? const Center(child: Text('No contacts to add'))
                : ListView.builder(
                    controller: controller,
                    itemCount: list.length,
                    itemBuilder: (context, index) {
                      final contact = list[index];
                      final selected = _selected.contains(contact.id);
                      return CheckboxListTile(
                        value: selected,
                        onChanged: (_) => setState(() {
                          if (selected) {
                            _selected.remove(contact.id);
                          } else {
                            _selected.add(contact.id);
                          }
                        }),
                        secondary: UserAvatar(
                          imageUrl: contact.resolvedAvatarUrl,
                          initials: contact.initials,
                          size: 42,
                          colorSeed: contact.id,
                        ),
                        title: Text(contact.displayName),
                        subtitle: Text(contact.handle),
                      );
                    },
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: _selected.isEmpty
                          ? null
                          : () => Navigator.pop(context, _selected.toList()),
                      child: const Text('Add'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
