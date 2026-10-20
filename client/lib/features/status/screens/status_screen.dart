import 'dart:async';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../../../core/theme.dart';
import '../../../shared/models/status_model.dart';
import '../../../shared/widgets/empty_state.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/services/auth_service.dart';
import '../services/status_service.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

class StatusScreen extends StatefulWidget {
  const StatusScreen({super.key});

  @override
  State<StatusScreen> createState() => _StatusScreenState();
}

class _StatusScreenState extends State<StatusScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<StatusService>().loadStatuses();
    });
  }

  @override
  Widget build(BuildContext context) {
    final service = context.watch<StatusService>();
    final myId = context.watch<AuthService>().currentUserId;
    final mine = service.myStatuses;
    final grouped = service.groupedByUser;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Status'),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const FaIcon(AppIcons.refresh),
            onPressed: () => context.read<StatusService>().loadStatuses(),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        tooltip: 'Add status',
        onPressed: () => _showCreateSheet(context),
        child: const FaIcon(AppIcons.edit),
      ),
      body: RefreshIndicator(
        onRefresh: () => context.read<StatusService>().loadStatuses(),
        child: service.isLoading && service.statuses.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                children: [
                  if (service.errorMessage != null)
                    _errorBanner(context, service.errorMessage!),
                  ListTile(
                    leading: Stack(
                      children: [
                        UserAvatar(
                          imageUrl: context.read<AuthService>().currentUser?.resolvedAvatarUrl,
                          initials: context.read<AuthService>().currentUser?.initials ?? '?',
                          size: 52,
                        ),
                        if (mine.isNotEmpty)
                          const Positioned(
                            right: 0,
                            bottom: 0,
                            child: CircleAvatar(
                              radius: 9,
                              backgroundColor: AppColors.green,
                              child: FaIcon(AppIcons.check, size: 12, color: Colors.white),
                            ),
                          ),
                      ],
                    ),
                    title: const Text('My status', style: TextStyle(fontWeight: FontWeight.w600)),
                    subtitle: Text(
                      mine.isEmpty
                          ? 'Tap to add a status update'
                          : '${mine.length} update${mine.length == 1 ? '' : 's'} · '
                              '${mine.fold<int>(0, (sum, s) => sum + s.viewedBy.length)} view'
                              '${mine.fold<int>(0, (sum, s) => sum + s.viewedBy.length) == 1 ? '' : 's'} · '
                              'expires in 24h',
                    ),
                    onTap: mine.isEmpty
                        ? () => _showCreateSheet(context)
                        : () => _viewStatuses(mine, isMine: true),
                    trailing: IconButton(
                      icon: const FaIcon(AppIcons.add),
                      onPressed: () => _showCreateSheet(context),
                    ),
                  ),
                  const Divider(height: 1),
                  if (grouped.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 60),
                      child: EmptyState(
                        icon: AppIcons.statusRing,
                        compact: true,
                        title: 'No recent updates',
                        message: 'Status updates from your contacts appear here for 24 hours.',
                      ),
                    )
                  else ...[
                    const Padding(
                      padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                      child: Text(
                        'Recent updates',
                        style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                      ),
                    ),
                    ...grouped.entries.map((entry) {
                      final statuses = entry.value;
                      final first = statuses.first;
                      final allViewed = statuses.every((s) => s.isViewedBy(myId));

                      return ListTile(
                        leading: UserAvatar(
                          imageUrl: first.user?.resolvedAvatarUrl,
                          initials: first.initials,
                          size: 52,
                          colorSeed: first.userId,
                        ),
                        title: Text(first.displayName),
                        subtitle: Text(
                          '${statuses.length} update${statuses.length == 1 ? '' : 's'} · '
                          '${_relative(first.createdAt)}',
                          style: TextStyle(
                            color: allViewed ? null : AppColors.green,
                            fontWeight: allViewed ? FontWeight.normal : FontWeight.w500,
                          ),
                        ),
                        onTap: () => _viewStatuses(statuses, isMine: false),
                      );
                    }),
                  ],
                  const SizedBox(height: 90),
                ],
              ),
      ),
    );
  }

  Widget _errorBanner(BuildContext context, String message) {
    return Container(
      width: double.infinity,
      color: Theme.of(context).colorScheme.errorContainer,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      child: Text(
        message,
        style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer),
      ),
    );
  }

  static String _relative(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    return '${diff.inDays}d ago';
  }

  // ------------------------------------------------------------- viewing
  Future<void> _viewStatuses(List<StatusModel> statuses, {required bool isMine}) async {
    final service = context.read<StatusService>();

    // Auto-advance: each update plays for a few seconds, then the next one
    // starts by itself, and the viewer closes after the last. Someone with a
    // dozen updates no longer has to tap through them one by one.
    Timer? autoAdvance;
    var scheduledFor = -1;

    try {
      await showDialog<void>(
        context: context,
        builder: (dialogContext) {
          var index = 0;

          return StatefulBuilder(
            builder: (context, setState) {
              final status = statuses[index.clamp(0, statuses.length - 1)];

              void advance() {
                if (index < statuses.length - 1) {
                  setState(() => index++);
                } else {
                  Navigator.pop(dialogContext);
                }
              }

              void back() {
                if (index > 0) setState(() => index--);
              }

              // Arm the timer once per index, after the frame settles.
              if (scheduledFor != index) {
                scheduledFor = index;
                autoAdvance?.cancel();
                autoAdvance = Timer(const Duration(seconds: 5), () {
                  if (dialogContext.mounted) advance();
                });
              }

              if (!isMine) {
                // Fire and forget — the row updates on the next rebuild.
                service.viewStatus(status.id);
              }

              return Dialog(
                insetPadding: const EdgeInsets.all(24),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 460, maxHeight: 620),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Segmented progress: one bar per update.
                      SizedBox(
                        height: 3,
                        child: Row(
                          children: List.generate(statuses.length, (i) {
                            return Expanded(
                              child: Container(
                                margin: const EdgeInsets.symmetric(horizontal: 1.5),
                                decoration: BoxDecoration(
                                  color: i < index
                                      ? AppColors.green
                                      : (i == index ? AppColors.green.withValues(alpha: 0.55) : Colors.white24),
                                  borderRadius: BorderRadius.circular(2),
                                ),
                              ),
                            );
                          }),
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Row(
                          children: [
                            UserAvatar(
                              imageUrl: status.user?.resolvedAvatarUrl,
                              initials: status.initials,
                              size: 38,
                              colorSeed: status.userId,
                            ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  isMine ? 'My status' : status.displayName,
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                ),
                                Text(
                                  _relative(status.createdAt),
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ],
                            ),
                          ),
                          if (isMine)
                            IconButton(
                              tooltip: 'Delete',
                              icon: const FaIcon(AppIcons.delete),
                              onPressed: () async {
                                await service.deleteStatus(status.id);
                                if (dialogContext.mounted) Navigator.pop(dialogContext);
                              },
                            ),
                          IconButton(
                            icon: const FaIcon(AppIcons.close),
                            onPressed: () => Navigator.pop(dialogContext),
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 1),
                    Expanded(
                      child: Container(
                        color: Colors.black,
                        width: double.infinity,
                        child: status.hasMedia
                            ? Image.network(
                                status.resolvedMediaUrl,
                                fit: BoxFit.contain,
                                errorBuilder: (_, __, ___) => const Center(
                                  child: FaIcon(AppIcons.brokenImage,
                                      color: Colors.white54, size: 56),
                                ),
                              )
                            : Center(
                                child: Padding(
                                  padding: const EdgeInsets.all(24),
                                  child: Text(
                                    status.text ?? '',
                                    textAlign: TextAlign.center,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 20,
                                    ),
                                  ),
                                ),
                              ),
                      ),
                    ),
                    if (status.hasMedia && status.hasText)
                      Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(status.text!, textAlign: TextAlign.center),
                      ),
                    if (isMine)
                      InkWell(
                        onTap: () => _showViewers(context, status),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                          child: Row(
                            children: [
                              const FaIcon(AppIcons.visibility, size: 20),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  status.viewers.isEmpty
                                      ? 'No views yet'
                                      : 'Viewed by ${status.viewers.length}',
                                  style: const TextStyle(fontWeight: FontWeight.w600),
                                ),
                              ),
                              if (status.viewers.isNotEmpty)
                                const FaIcon(AppIcons.chevronRight, size: 20),
                            ],
                          ),
                        ),
                      ),
                    if (statuses.length > 1)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            IconButton(
                              icon: const FaIcon(AppIcons.chevronLeft),
                              onPressed: index > 0 ? back : null,
                            ),
                            Text('${index + 1} / ${statuses.length}'),
                            IconButton(
                              icon: const FaIcon(AppIcons.chevronRight),
                              onPressed: advance,
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        );
      },
      );
    } finally {
      // Never leave a timer running after the viewer closes.
      autoAdvance?.cancel();
    }
  }

  // ------------------------------------------------------------- viewers
  /// Shows who has seen one of my statuses.
  void _showViewers(BuildContext context, StatusModel status) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Row(
                  children: [
                    const FaIcon(AppIcons.visibility, size: 20),
                    const SizedBox(width: 10),
                    Text(
                      status.viewers.isEmpty
                          ? 'No views yet'
                          : 'Viewed by ${status.viewers.length}',
                      style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                    ),
                  ],
                ),
              ),
              if (status.viewers.isEmpty)
                const Padding(
                  padding: EdgeInsets.fromLTRB(20, 4, 20, 24),
                  child: Text(
                    'Nobody has opened this status yet. Contacts you share it '
                    'with will appear here as soon as they view it.',
                    style: TextStyle(fontSize: 13.5),
                  ),
                )
              else
                Flexible(
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: status.viewers.length,
                    itemBuilder: (context, index) {
                      final viewer = status.viewers[index];
                      return ListTile(
                        leading: UserAvatar(
                          imageUrl: viewer.resolvedAvatarUrl,
                          initials: viewer.initials,
                          size: 42,
                          colorSeed: viewer.id,
                        ),
                        title: Text(viewer.displayName),
                        subtitle: Text(viewer.handle),
                      );
                    },
                  ),
                ),
              const SizedBox(height: 8),
            ],
          ),
        );
      },
    );
  }

  // ------------------------------------------------------------ creating
  Future<void> _showCreateSheet(BuildContext context) async {
    final controller = TextEditingController();

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(sheetContext).bottom,
          left: 16,
          right: 16,
          top: 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'New status',
              style: Theme.of(sheetContext)
                  .textTheme
                  .titleLarge
                  ?.copyWith(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              maxLines: 4,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Type a status update…'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    icon: const FaIcon(AppIcons.photo),
                    label: const Text('Photo'),
                    onPressed: () async {
                      Navigator.pop(sheetContext);
                      await _pickImageStatus(context);
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    icon: const FaIcon(AppIcons.send),
                    label: const Text('Post'),
                    onPressed: () async {
                      final text = controller.text.trim();
                      if (text.isEmpty) return;
                      Navigator.pop(sheetContext);
                      final ok = await context.read<StatusService>().createStatus(text: text);
                      if (!context.mounted) return;
                      if (!ok) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              context.read<StatusService>().errorMessage ??
                                  'Could not post the status',
                            ),
                          ),
                        );
                      }
                    },
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );

    controller.dispose();
  }

  Future<void> _pickImageStatus(BuildContext context) async {
    try {
      final file = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
      if (file == null || !context.mounted) return;

      final bytes = await file.readAsBytes();
      if (!context.mounted) return;

      final messenger = ScaffoldMessenger.of(context);
      messenger.showSnackBar(const SnackBar(content: Text('Uploading status…')));

      final ok = await context.read<StatusService>().createMediaStatus(
            bytes: bytes,
            filename: file.name,
            mimeType: file.mimeType,
          );

      if (!context.mounted) return;
      messenger.hideCurrentSnackBar();
      if (!ok) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(
              context.read<StatusService>().errorMessage ?? 'Could not upload the status',
            ),
          ),
        );
      }
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not pick an image: $e')),
      );
    }
  }
}
