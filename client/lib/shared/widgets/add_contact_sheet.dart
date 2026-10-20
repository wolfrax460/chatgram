import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../features/auth/services/auth_service.dart';
import '../../features/contacts/services/contacts_service.dart';
import '../models/user_model.dart';
import 'user_avatar.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Bottom sheet for finding people and adding them to your contacts.
///
/// Search hits the whole directory; when the box is empty we show people you
/// already share a conversation with, since those are the likely additions.
Future<void> showAddContactSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (_) => const _AddContactSheet(),
  );
}

class _AddContactSheet extends StatefulWidget {
  const _AddContactSheet();

  @override
  State<_AddContactSheet> createState() => _AddContactSheetState();
}

class _AddContactSheetState extends State<_AddContactSheet> {
  final TextEditingController _search = TextEditingController();
  Timer? _debounce;

  List<DirectoryResult> _results = [];
  bool _searching = false;
  String? _error;
  final Set<String> _adding = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ContactsService>().loadSuggestions();
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    if (value.trim().isEmpty) {
      setState(() {
        _results = [];
        _searching = false;
        _error = null;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 350), () => _run(value));
  }

  Future<void> _run(String query) async {
    setState(() {
      _searching = true;
      _error = null;
    });

    final results = await context.read<ContactsService>().searchDirectory(query);
    if (!mounted) return;
    setState(() {
      _searching = false;
      _results = results;
    });
  }

  Future<void> _add(UserModel user) async {
    setState(() => _adding.add(user.id));

    final contacts = context.read<ContactsService>();
    final messenger = ScaffoldMessenger.of(context);
    final ok = await contacts.addContact(user.id);

    if (!mounted) return;
    setState(() => _adding.remove(user.id));

    if (ok) {
      messenger.showSnackBar(
        SnackBar(content: Text('${user.displayName} added to your contacts')),
      );
      setState(() {
        final index = _results.indexWhere((r) => r.user.id == user.id);
        if (index != -1) {
          _results[index] = DirectoryResult(user: _results[index].user, isContact: true);
        }
      });
    } else {
      setState(() => _error = contacts.errorMessage);
    }
  }

  Future<void> _remove(UserModel user) async {
    setState(() => _adding.add(user.id));
    final contacts = context.read<ContactsService>();
    final ok = await contacts.removeContact(user.id);
    if (!mounted) return;
    setState(() {
      _adding.remove(user.id);
      if (ok) {
        final index = _results.indexWhere((r) => r.user.id == user.id);
        if (index != -1) {
          _results[index] = DirectoryResult(user: _results[index].user, isContact: false);
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final contacts = context.watch<ContactsService>();
    final myId = context.watch<AuthService>().currentUserId;
    final query = _search.text.trim();

    final suggestions = contacts.suggestions.where((u) => u.id != myId).toList();

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.8,
      maxChildSize: 0.95,
      builder: (context, scrollController) {
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 8, 8),
              child: Row(
                children: [
                  const FaIcon(AppIcons.personAdd, size: 22),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Add a contact',
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w600),
                    ),
                  ),
                  IconButton(
                    icon: const FaIcon(AppIcons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: TextField(
                controller: _search,
                autofocus: true,
                textInputAction: TextInputAction.search,
                onChanged: _onChanged,
                decoration: InputDecoration(
                  hintText: 'Search by name, phone or email',
                  prefixIcon: const FaIcon(AppIcons.search, size: 20),
                  isDense: true,
                  suffixIcon: _searching
                      ? const Padding(
                          padding: EdgeInsets.all(12),
                          child: SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : (query.isNotEmpty
                          ? IconButton(
                              icon: const FaIcon(AppIcons.clear, size: 18),
                              onPressed: () {
                                _search.clear();
                                _onChanged('');
                              },
                            )
                          : null),
                ),
              ),
            ),
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
            const Divider(height: 1),
            Expanded(
              child: query.isEmpty
                  ? _suggestionList(context, suggestions, scrollController, contacts)
                  : _resultList(scrollController, myId),
            ),
          ],
        );
      },
    );
  }

  Widget _suggestionList(
    BuildContext context,
    List<UserModel> suggestions,
    ScrollController controller,
    ContactsService contacts,
  ) {
    if (suggestions.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(28),
        child: Center(
          child: Text(
            'Start typing a name, phone number or email address to find someone.',
            textAlign: TextAlign.center,
          ),
        ),
      );
    }

    return ListView(
      controller: controller,
      children: [
        const Padding(
          padding: EdgeInsets.fromLTRB(16, 14, 16, 6),
          child: Text(
            'PEOPLE YOU HAVE CHATTED WITH',
            style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 0.5),
          ),
        ),
        ...suggestions.map((user) => _tile(user, inContacts: contacts.isContact(user.id))),
        const SizedBox(height: 20),
      ],
    );
  }

  Widget _resultList(ScrollController controller, String? myId) {
    if (_searching && _results.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_results.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(28),
        child: Center(child: Text('No one found with that name, phone or email.')),
      );
    }

    return ListView.builder(
      controller: controller,
      itemCount: _results.length,
      itemBuilder: (context, index) {
        final result = _results[index];
        return _tile(result.user, inContacts: result.isContact);
      },
    );
  }

  Widget _tile(UserModel user, {required bool inContacts}) {
    final busy = _adding.contains(user.id);

    return ListTile(
      leading: UserAvatar(
        imageUrl: user.resolvedAvatarUrl,
        initials: user.initials,
        size: 44,
        showPresence: true,
        isOnline: user.isOnline,
        colorSeed: user.id,
      ),
      title: Text(user.displayName.isEmpty ? 'Unknown' : user.displayName),
      subtitle: Text(user.handle),
      trailing: busy
          ? const SizedBox(
              width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
          : inContacts
              ? TextButton.icon(
                  onPressed: () => _remove(user),
                  icon: const FaIcon(AppIcons.check, size: 16),
                  label: const Text('Added'),
                )
              : FilledButton(
                  onPressed: () => _add(user),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size(84, 34),
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                  ),
                  child: const Text('Add'),
                ),
    );
  }
}
