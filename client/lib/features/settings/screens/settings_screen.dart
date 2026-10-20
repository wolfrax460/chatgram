import 'package:font_awesome_flutter/font_awesome_flutter.dart';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../server_config.dart';
import '../../../shared/widgets/responsive.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/services/auth_service.dart';
import 'package:chatgram/core/app_icons.dart';
import '../../chat/services/chat_service.dart';
import '../../contacts/services/contacts_service.dart';
import '../services/privacy_service.dart';
import '../services/settings_service.dart';
import '../services/version_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final settings = context.watch<SettingsService>();
    final version = context.watch<VersionService>();
    final privacy = context.watch<PrivacyService>();
    final user = auth.currentUser;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      // Cap the width on large screens so rows do not stretch into a 2000px
      // line of text on an ultrawide monitor.
      body: MaxContentWidth(
        child: ListView(
          children: [
            const SizedBox(height: 8),
          ListTile(
            leading: UserAvatar(
              imageUrl: user?.resolvedAvatarUrl,
              initials: user?.initials ?? '?',
              size: 56,
            ),
            title: Text(
              user?.displayName.isNotEmpty == true ? user!.displayName : 'Your profile',
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 17),
            ),
            subtitle: Text(user?.about?.isNotEmpty == true ? user!.about! : user?.handle ?? ''),
            trailing: const FaIcon(AppIcons.edit, size: 20),
            onTap: () => _editProfile(context),
          ),
          const Divider(height: 1),

          const _SectionHeader('Account'),
          SwitchListTile(
            secondary: const FaIcon(AppIcons.bell),
            title: const Text('Notifications'),
            subtitle: const Text('Show a banner for new messages'),
            value: settings.notificationsEnabled,
            onChanged: (value) => context.read<SettingsService>().setNotifications(value),
          ),
          SwitchListTile(
            secondary: const FaIcon(AppIcons.volume),
            title: const Text('Message sounds'),
            value: settings.soundsEnabled,
            onChanged: (value) => context.read<SettingsService>().setSounds(value),
          ),
          SwitchListTile(
            secondary: const FaIcon(AppIcons.read),
            title: const Text('Read receipts'),
            subtitle: const Text('Share when you have read messages'),
            value: settings.readReceiptsEnabled,
            onChanged: (value) => context.read<SettingsService>().setReadReceipts(value),
          ),
          ListTile(
            leading: const FaIcon(AppIcons.theme),
            title: const Text('Theme'),
            subtitle: Text(_themeLabel(settings.themeMode)),
            trailing: const FaIcon(AppIcons.chevronRight, size: 20),
            onTap: () => _pickTheme(context, settings),
          ),

          const Divider(height: 1),
          const _SectionHeader('Privacy'),
          SwitchListTile(
            secondary: const FaIcon(AppIcons.visibility),
            title: const Text('Show when I am online'),
            subtitle: Text(
              privacy.showOnlineStatus
                  ? 'Contacts can see your online status and last seen'
                  : 'Nobody can see when you are online',
            ),
            value: privacy.showOnlineStatus,
            onChanged: privacy.isSaving
                ? null
                : (value) => context.read<PrivacyService>().setShowOnlineStatus(value),
          ),
          ListTile(
            enabled: privacy.showOnlineStatus,
            leading: const FaIcon(AppIcons.personBlocked),
            title: const Text('Hide from specific people'),
            subtitle: Text(
              privacy.hiddenFrom.isEmpty
                  ? 'Everyone can see it'
                  : '${privacy.hiddenFrom.length} '
                      '${privacy.hiddenFrom.length == 1 ? 'person' : 'people'} cannot see it',
            ),
            trailing: const FaIcon(AppIcons.chevronRight, size: 20),
            onTap: privacy.showOnlineStatus ? () => _pickHiddenFrom(context) : null,
          ),

          const Divider(height: 1),
          const _SectionHeader('Support'),
          ListTile(
            leading: const FaIcon(AppIcons.chatFilled),
            title: const Text('Help & feedback'),
            subtitle: const Text('Report a bug, ask for help or request a change'),
            trailing: const FaIcon(AppIcons.chevronRight, size: 20),
            onTap: () async {
              final chatService = context.read<ChatService>();
              final navigator = Navigator.of(context);
              final messenger = ScaffoldMessenger.of(context);

              final chatId = await chatService.openSupportChat();
              if (!context.mounted) return;

              if (chatId != null) {
                navigator.pushNamed('/chat/$chatId');
              } else {
                messenger.showSnackBar(
                  SnackBar(
                    content: Text(chatService.errorMessage ?? 'Could not open support chat'),
                  ),
                );
              }
            },
          ),

          const Divider(height: 1),
          const _SectionHeader('About'),
          ListTile(
            leading: const FaIcon(AppIcons.info),
            title: const Text('Chatgram'),
            subtitle: Text('Version ${version.appVersion}'
                '${version.latestVersion != null && version.latestVersion != version.appVersion ? '  ·  latest ${version.latestVersion}' : ''}'),
            trailing: version.isChecking
                ? const SizedBox(
                    width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : IconButton(
                    tooltip: 'Check for updates',
                    icon: const FaIcon(AppIcons.refresh),
                    onPressed: () => context.read<VersionService>().check(),
                  ),
          ),
          if (version.shouldNotify)
            ListTile(
              leading: FaIcon(
                version.updateRequired ? AppIcons.error : AppIcons.download,
                color: version.updateRequired ? Theme.of(context).colorScheme.error : null,
              ),
              title: Text(version.updateRequired
                  ? 'Update required'
                  : 'Update to ${version.latestVersion}'),
              subtitle: Text(version.releaseNotes?.isNotEmpty == true
                  ? version.releaseNotes!
                  : (version.updateRequired
                      ? 'This version is no longer supported.'
                      : 'A newer version of Chatgram is available.')),
              onTap: (version.updateUrl?.isNotEmpty ?? false)
                  ? () => launchUrl(
                        Uri.parse(version.updateUrl!),
                        mode: LaunchMode.externalApplication,
                      )
                  : null,
            ),
          ListTile(
            leading: const FaIcon(AppIcons.server),
            title: const Text('Server'),
            subtitle: Text(apiBaseUrl),
          ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton.icon(
              icon: const FaIcon(AppIcons.logout),
              label: const Text('Log out'),
              style: OutlinedButton.styleFrom(
                foregroundColor: Theme.of(context).colorScheme.error,
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: () => _confirmLogout(context),
            ),
          ),
          const SizedBox(height: 40),
        ],
        ),
      ),
    );
  }

  static String _themeLabel(ThemeMode mode) {
    switch (mode) {
      case ThemeMode.light:
        return 'Light';
      case ThemeMode.dark:
        return 'Dark';
      case ThemeMode.system:
        return 'System default';
    }
  }

  Future<void> _pickTheme(BuildContext context, SettingsService settings) async {
    final selected = await showModalBottomSheet<ThemeMode>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: ThemeMode.values
              .map((mode) => ListTile(
                    leading: FaIcon(
                      settings.themeMode == mode
                          ? AppIcons.selected
                          : AppIcons.unselected,
                    ),
                    title: Text(_themeLabel(mode)),
                    onTap: () => Navigator.pop(sheetContext, mode),
                  ))
              .toList(),
        ),
      ),
    );
    if (selected != null && context.mounted) {
      await context.read<SettingsService>().setThemeMode(selected);
    }
  }

  Future<void> _confirmLogout(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Log out?'),
        content: const Text('You will need to sign in again to use Chatgram.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('Log out'),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;

    await context.read<AuthService>().logout();
    if (context.mounted) {
      Navigator.of(context).pushNamedAndRemoveUntil('/login', (_) => false);
    }
  }

  Future<void> _editProfile(BuildContext context) async {
    final auth = context.read<AuthService>();
    final user = auth.currentUser;
    if (user == null) return;

    final nameController = TextEditingController(text: user.displayName);
    final aboutController = TextEditingController(text: user.about ?? '');

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Edit profile'),
        content: SizedBox(
          width: 360,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              StatefulBuilder(
                builder: (context, setSheetState) => Column(
                  children: [
                    UserAvatar(
                      imageUrl: auth.currentUser?.resolvedAvatarUrl,
                      initials: auth.currentUser?.initials ?? '?',
                      size: 84,
                    ),
                    TextButton.icon(
                      icon: const FaIcon(AppIcons.camera, size: 18),
                      label: const Text('Change photo'),
                      onPressed: () async {
                        final ok = await _pickAvatar(context, auth);
                        if (ok) setSheetState(() {});
                      },
                    ),
                  ],
                ),
              ),
              TextField(
                controller: nameController,
                decoration: const InputDecoration(labelText: 'Display name'),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: aboutController,
                decoration: const InputDecoration(labelText: 'About'),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              final ok = await auth.updateProfile(
                displayName: nameController.text.trim(),
                about: aboutController.text.trim(),
              );
              if (!dialogContext.mounted) return;
              Navigator.pop(dialogContext);
              if (!ok) {
                ScaffoldMessenger.of(dialogContext).showSnackBar(
                  SnackBar(content: Text(auth.errorMessage ?? 'Could not save profile')),
                );
              }
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );

    nameController.dispose();
    aboutController.dispose();
  }

  Future<bool> _pickAvatar(BuildContext context, AuthService auth) async {
    try {
      final file = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 80);
      if (file == null) return false;

      final bytes = await file.readAsBytes();
      final ok = await auth.uploadAvatar(
        bytes: bytes,
        filename: file.name,
        mimeType: file.mimeType,
      );

      if (!ok && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(auth.errorMessage ?? 'Could not upload the photo')),
        );
      }
      return ok;
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not pick an image: $e')),
        );
      }
      return false;
    }
  }
  /// Pick which contacts must never see my online status.
  Future<void> _pickHiddenFrom(BuildContext context) async {
    final privacy = context.read<PrivacyService>();
    final contacts = context.read<ContactsService>();
    if (contacts.contacts.isEmpty) await contacts.loadContacts();
    if (!context.mounted) return;

    final myId = context.read<AuthService>().currentUserId;
    final candidates = contacts.contacts.where((c) => c.id != myId).toList();

    if (candidates.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Add some contacts first.')),
      );
      return;
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          return DraggableScrollableSheet(
            expand: false,
            initialChildSize: 0.75,
            builder: (context, controller) => Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                  child: Row(
                    children: [
                      const FaIcon(AppIcons.personBlocked, size: 20),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Hide my online status from',
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(fontWeight: FontWeight.w600),
                        ),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: ListView.builder(
                    controller: controller,
                    itemCount: candidates.length,
                    itemBuilder: (context, index) {
                      final contact = candidates[index];
                      final hidden = privacy.isHiddenFrom(contact.id);
                      return CheckboxListTile(
                        value: hidden,
                        title: Text(contact.displayName),
                        subtitle: Text(contact.handle),
                        onChanged: (checked) async {
                          if (checked == true) {
                            await privacy.hideFrom(contact);
                          } else {
                            await privacy.showTo(contact.id);
                          }
                          setSheetState(() {});
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.label);

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 6),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}
