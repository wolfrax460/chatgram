import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../shared/models/user_model.dart';
import '../../../shared/widgets/add_contact_sheet.dart';
import '../../../shared/widgets/empty_state.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/services/auth_service.dart';
import '../services/contacts_service.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Your address book — only people you added, not every account in the app.
class ContactsScreen extends StatefulWidget {
  const ContactsScreen({super.key});

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<ContactsService>().loadContacts();
    });
  }

  @override
  Widget build(BuildContext context) {
    final service = context.watch<ContactsService>();
    final myId = context.watch<AuthService>().currentUserId;
    final contacts = service.filtered.where((c) => c.id != myId).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Contacts'),
        actions: [
          IconButton(
            tooltip: 'Add contact',
            icon: const FaIcon(AppIcons.personAdd),
            onPressed: () => showAddContactSheet(context),
          ),
          IconButton(
            tooltip: 'Refresh',
            icon: const FaIcon(AppIcons.refresh),
            onPressed: () => context.read<ContactsService>().loadContacts(),
          ),
        ],
      ),
      body: Column(
        children: [
          // Search only filters MY contacts — the directory lives in the
          // "Add contact" sheet.
          if (service.contacts.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
              child: TextField(
                onChanged: (value) => context.read<ContactsService>().setSearchQuery(value),
                decoration: const InputDecoration(
                  hintText: 'Search my contacts',
                  prefixIcon: FaIcon(AppIcons.search, size: 20),
                  isDense: true,
                ),
              ),
            ),
          if (service.errorMessage != null)
            Container(
              width: double.infinity,
              color: Theme.of(context).colorScheme.errorContainer,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Text(
                service.errorMessage!,
                style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
              ),
            ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () => context.read<ContactsService>().loadContacts(),
              child: Builder(
                builder: (context) {
                  if (service.isLoading && service.contacts.isEmpty) {
                    return const Center(child: CircularProgressIndicator());
                  }

                  if (contacts.isEmpty) {
                    return ListView(
                      children: [
                        SizedBox(height: MediaQuery.sizeOf(context).height * 0.10),
                        EmptyState(
                          icon: service.searchQuery.isEmpty
                              ? AppIcons.contacts
                              : AppIcons.searchOff,
                          title: service.searchQuery.isEmpty
                              ? 'No contacts yet'
                              : 'No matches',
                          message: service.searchQuery.isEmpty
                              ? 'Add the people you want to chat with. Only they '
                                  'will appear here — not every account in Chatgram.'
                              : 'None of your contacts match "${service.searchQuery}".',
                          actionLabel: service.searchQuery.isEmpty ? 'Add a contact' : null,
                          onAction: service.searchQuery.isEmpty
                              ? () => showAddContactSheet(context)
                              : null,
                        ),
                      ],
                    );
                  }

                  final online = contacts.where((c) => c.isOnline).toList();
                  final offline = contacts.where((c) => !c.isOnline).toList();

                  return ListView(
                    children: [
                      if (online.isNotEmpty) ...[
                        const _SectionHeader('Online'),
                        ...online.map(_tile),
                      ],
                      if (offline.isNotEmpty) ...[
                        _SectionHeader(
                          online.isEmpty ? '${contacts.length} contact'
                              '${contacts.length == 1 ? '' : 's'}' : 'Offline',
                        ),
                        ...offline.map(_tile),
                      ],
                      const SizedBox(height: 90),
                    ],
                  );
                },
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => showAddContactSheet(context),
        icon: const FaIcon(AppIcons.personAdd),
        label: const Text('Add contact'),
      ),
    );
  }

  Widget _tile(UserModel contact) {
    return ListTile(
      leading: UserAvatar(
        imageUrl: contact.resolvedAvatarUrl,
        initials: contact.initials,
        size: 46,
        showPresence: true,
        isOnline: contact.isOnline,
        colorSeed: contact.id,
      ),
      title: Text(contact.displayName.isEmpty ? 'Unknown' : contact.displayName),
      subtitle: Text(
        contact.handle,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: const FaIcon(AppIcons.chevronRight, size: 20),
      onTap: () => Navigator.of(context).pushNamed('/user/${contact.id}'),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 4),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, letterSpacing: 0.5),
      ),
    );
  }
}
