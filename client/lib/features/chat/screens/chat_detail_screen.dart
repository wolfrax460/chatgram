import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:record/record.dart';

import '../../../core/theme.dart';
import '../../../shared/models/chat_model.dart';
import '../../../shared/models/message_model.dart';
import '../../../shared/services/media_bytes.dart';
import '../../../shared/widgets/empty_state.dart';
import '../../../shared/widgets/message_bubble.dart';
import '../../../shared/widgets/user_avatar.dart';
import '../../auth/services/auth_service.dart';
import '../services/chat_service.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Conversation view. Embeddable (desktop three-pane) and usable as a page.
class ChatDetailPane extends StatefulWidget {
  const ChatDetailPane({
    super.key,
    required this.chatId,
    this.onBack,
    this.embedded = false,
  });

  final String chatId;
  final VoidCallback? onBack;

  /// Embedded panes do not own the AppBar / navigation.
  final bool embedded;

  @override
  State<ChatDetailPane> createState() => _ChatDetailPaneState();
}

class _ChatDetailPaneState extends State<ChatDetailPane> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final FocusNode _inputFocus = FocusNode();

  int _lastMessageCount = 0;
  String? _errorShown;
  Timer? _typingThrottle;

  // ------------------------------------------------------------ voice notes
  final AudioRecorder _recorder = AudioRecorder();
  bool _isRecording = false;
  bool _isSendingRecording = false;
  Duration _recordDuration = Duration.zero;
  Timer? _recordTimer;

  /// `record`'s preferred container per platform: m4a/aac is safest on Android
  /// and Windows, web uses the browser's own encoder (webm/opus).
  RecordConfig get _recordConfig => const RecordConfig(
        encoder: AudioEncoder.aacLc,
        bitRate: 96000,
        sampleRate: 44100,
      );

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) => _activate());
  }

  @override
  void didUpdateWidget(covariant ChatDetailPane oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.chatId != widget.chatId) {
      _lastMessageCount = 0;
      WidgetsBinding.instance.addPostFrameCallback((_) => _activate());
    }
  }

  void _activate() {
    if (!mounted) return;
    final service = context.read<ChatService>();
    service.setActiveChat(widget.chatId);
    service.loadMessages(widget.chatId);
  }

  @override
  void dispose() {
    _typingThrottle?.cancel();
    _recordTimer?.cancel();
    // Best-effort cleanup; the widget may be gone before this resolves.
    _recorder.stop().catchError((_) => '');
    _recorder.dispose();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _messageController.dispose();
    _inputFocus.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------- recording
  /// Temp file for the in-progress recording. Resolved through `path_provider`
  /// so no `dart:io` import is needed (which would break the web build).
  Future<String> _recordingPath() async {
    final dir = await getTemporaryDirectory();
    return '${dir.path}/chatgram-voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
  }

  Future<void> _startRecording() async {
    try {
      if (!await _recorder.hasPermission()) {
        _showSnack(
          kIsWeb
              ? 'Microphone blocked. Browsers only allow recording over HTTPS '
                  'or on localhost — use the Android or Windows app, or serve '
                  'the site over HTTPS.'
              : 'Microphone permission is required to send voice notes.',
        );
        return;
      }

      // Web ignores the path; native writes the recording to a temp file.
      final path = kIsWeb ? '' : await _recordingPath();

      await _recorder.start(_recordConfig, path: path);

      setState(() {
        _isRecording = true;
        _recordDuration = Duration.zero;
        _isSendingRecording = false;
      });

      _recordTimer?.cancel();
      _recordTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() => _recordDuration += const Duration(seconds: 1));
      });
    } catch (e) {
      debugPrint('Start recording failed: $e');
      _showSnack('Could not start recording: $e');
    }
  }

  Future<void> _finishRecording({required bool send}) async {
    _recordTimer?.cancel();

    String? path;
    try {
      path = await _recorder.stop();
    } catch (e) {
      debugPrint('Stop recording failed: $e');
    }

    if (!mounted) return;
    final wasRecording = _isRecording;
    setState(() {
      _isRecording = false;
      _isSendingRecording = false;
    });

    if (!send || path == null || !wasRecording) return;
    if (_recordDuration < const Duration(seconds: 1)) {
      _showSnack('Recording was too short');
      return;
    }

    setState(() => _isSendingRecording = true);
    final messenger = ScaffoldMessenger.of(context);
    messenger.showSnackBar(const SnackBar(content: Text('Sending voice note…')));

    try {
      final bytes = await readMediaBytes(path);
      if (!mounted) return;

      final ok = await context.read<ChatService>().sendMediaMessage(
            chatId: widget.chatId,
            bytes: bytes,
            filename: 'voice-note-${DateTime.now().millisecondsSinceEpoch}.m4a',
            type: 'audio',
            mimeType: 'audio/mp4',
          );

      if (!mounted) return;
      messenger.hideCurrentSnackBar();
      if (!ok) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(context.read<ChatService>().errorMessage ?? 'Could not send voice note'),
          ),
        );
      }
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      messenger.hideCurrentSnackBar();
      messenger.showSnackBar(SnackBar(content: Text('Could not send voice note: $e')));
    } finally {
      if (mounted) setState(() => _isSendingRecording = false);
    }
  }

  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  void _onScroll() {
    // Reached the top -> pull in older messages.
    if (_scrollController.hasClients &&
        _scrollController.position.pixels <= 40 &&
        context.read<ChatService>().hasMoreMessages(widget.chatId)) {
      context.read<ChatService>().loadMessages(widget.chatId, loadMore: true);
    }
  }

  void _scrollToBottom({bool animate = true}) {
    if (!_scrollController.hasClients) return;
    final target = _scrollController.position.maxScrollExtent;
    if (animate) {
      _scrollController.animateTo(
        target,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    } else {
      _scrollController.jumpTo(target);
    }
  }

  void _onChanged(String value) {
    final service = context.read<ChatService>();
    if (value.trim().isEmpty) {
      service.stopTyping(widget.chatId);
      return;
    }
    // Throttle: one start event per 1.5s, the service auto-stops after 2s.
    _typingThrottle ??= Timer(const Duration(milliseconds: 1500), () {
      _typingThrottle = null;
    });
    if (_typingThrottle != null) service.notifyTyping(widget.chatId);
  }

  Future<void> _send() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    _messageController.clear();
    context.read<ChatService>().stopTyping(widget.chatId);
    final ok = await context.read<ChatService>().sendMessage(
          chatId: widget.chatId,
          type: 'text',
          content: text,
        );

    if (!mounted) return;
    if (!ok) {
      final error = context.read<ChatService>().errorMessage;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(error ?? 'Message could not be sent')),
      );
    }
    _scrollToBottom();
  }

  @override
  Widget build(BuildContext context) {
    final chatService = context.watch<ChatService>();
    final auth = context.watch<AuthService>();
    final myId = auth.currentUserId;
    final chat = chatService.chatById(widget.chatId);
    final messages = chatService.messagesFor(widget.chatId);

    // Auto-scroll when a new message lands.
    if (messages.length != _lastMessageCount) {
      final grew = messages.length > _lastMessageCount;
      _lastMessageCount = messages.length;
      if (grew) {
        WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToBottom());
      }
    }

    final error = chatService.errorMessage;
    if (error != null && error != _errorShown) {
      _errorShown = error;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error)));
        context.read<ChatService>().clearError();
        _errorShown = null;
      });
    }

    return Column(
      children: [
        if (!widget.embedded) _appBar(context, chat, chatService, myId),
        Expanded(
          child: Container(
            color: context.chatCanvas,
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 1100),
                child: messages.isEmpty
                    ? _emptyConversation(chat)
                    : _messageList(messages, chat, myId, chatService),
              ),
            ),
          ),
        ),
        _typingIndicator(chatService),
        _composer(context, chat),
      ],
    );
  }

  Widget _appBar(
    BuildContext context,
    ChatModel? chat,
    ChatService chatService,
    String? myId,
  ) {
    final title = chat?.displayTitle(myId) ?? 'Chat';
    final subtitle = _subtitle(chat, chatService, myId);

    return AppBar(
      leading: widget.onBack != null
          ? IconButton(icon: const FaIcon(AppIcons.back), onPressed: widget.onBack)
          : null,
      titleSpacing: widget.onBack != null ? 0 : 12,
      // Tapping the header opens the contact's profile (direct chats) or the
      // group info sheet.
      title: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: chat == null ? null : () => _openProfile(context, chat, myId),
        child: Row(
          children: [
            if (chat != null)
              UserAvatar(
                imageUrl: chat.avatarFor(myId),
                initials: chat.initialsFor(myId),
                size: 38,
                colorSeed: chat.id,
              ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (subtitle != null)
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, color: Colors.white70),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
      actions: [
        IconButton(
          tooltip: 'Chat info',
          icon: const FaIcon(AppIcons.info),
          onPressed: () => _showChatInfo(context, chat),
        ),
      ],
    );
  }

  /// Opens the contact's profile for a 1:1 chat, or the group info sheet.
  void _openProfile(BuildContext context, ChatModel chat, String? myId) {
    final otherId = chat.isGroup ? null : chat.otherParticipant(myId)?.id;
    if (otherId != null && otherId.isNotEmpty) {
      Navigator.of(context).pushNamed('/user/$otherId');
    } else {
      _showChatInfo(context, chat);
    }
  }

  String? _subtitle(ChatModel? chat, ChatService service, String? myId) {    if (chat == null) return null;
    if (service.isOtherTyping(chat.id)) return 'typing…';
    if (chat.isGroup) {
      final others = chat.participants.where((p) => p.id != myId).length;
      return '$others member${others == 1 ? '' : 's'}';
    }
    final other = chat.otherParticipant(myId);
    if (other == null) return null;
    if (other.isOnline) return 'online';
    final lastSeen = other.lastSeen;
    if (lastSeen == null) return null;
    return 'last seen ${_relative(lastSeen)}';
  }

  static String _relative(DateTime time) {
    final diff = DateTime.now().difference(time);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays == 1) return 'yesterday';
    return DateFormat.MMMd().format(time);
  }

  Widget _emptyConversation(ChatModel? chat) {
    return EmptyState(
      icon: AppIcons.lock,
      compact: true,
      title: 'No messages yet',
      message: chat == null
          ? 'Start the conversation.'
          : 'Say hello to ${chat.displayTitle(context.read<AuthService>().currentUserId)}.',
    );
  }

  Widget _messageList(
    List<MessageModel> messages,
    ChatModel? chat,
    String? myId,
    ChatService chatService,
  ) {
    final participantIds = chat?.participantIds ?? const <String>[];

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.symmetric(vertical: 10),
      itemCount: messages.length,
      itemBuilder: (context, index) {
        final message = messages[index];
        final previous = index > 0 ? messages[index - 1] : null;

        final showDateSeparator = previous == null ||
            !_sameDay(previous.sentAt, message.sentAt);
        // `!showDateSeparator` implies `previous != null`, so flow analysis
        // has already promoted it here.
        final showSenderName = (chat?.isGroup ?? false) &&
            !showDateSeparator &&
            previous.senderId != message.senderId;

        final senderName = chat?.participants
            .where((p) => p.id == message.senderId)
            .map((p) => p.displayName)
            .firstOrNull;

        final isMine = message.senderId == myId;

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (showDateSeparator) _dateSeparator(context, message.sentAt),
            MessageBubble(
              message: message,
              isMine: isMine,
              status: message.statusFor(myId, participantIds),
              senderName: senderName,
              showSenderName: showSenderName,
              maxWidthFraction: 0.72,
              onRetry: message.failed
                  ? () => chatService.resendMessage(message.chatId, message)
                  : null,
            ),
          ],
        );
      },
    );
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  Widget _dateSeparator(BuildContext context, DateTime time) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final that = DateTime(time.year, time.month, time.day);
    final diff = today.difference(that).inDays;

    final label = diff == 0
        ? 'Today'
        : diff == 1
            ? 'Yesterday'
            : DateFormat.yMMMMd().format(time);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
          decoration: BoxDecoration(
            color: context.isDark ? const Color(0xFF182229) : const Color(0xFFE1F3FB),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            label,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
          ),
        ),
      ),
    );
  }

  Widget _typingIndicator(ChatService chatService) {
    if (!chatService.isOtherTyping(widget.chatId)) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      color: context.chatCanvas,
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 6),
      child: const Text(
        'typing…',
        style: TextStyle(
          fontSize: 12.5,
          fontStyle: FontStyle.italic,
          color: AppColors.green,
        ),
      ),
    );
  }

  Widget _composer(BuildContext context, ChatModel? chat) {
    if (_isRecording) return _recordingBar(context);

    return Container(
      color: context.isDark ? const Color(0xFF202C33) : const Color(0xFFF0F2F5),
      child: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1100),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 6, 8, 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    tooltip: 'Attach',
                    icon: const FaIcon(AppIcons.add),
                    onPressed: () => _showAttachmentSheet(context),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _messageController,
                      focusNode: _inputFocus,
                      minLines: 1,
                      maxLines: 5,
                      textCapitalization: TextCapitalization.sentences,
                      textInputAction: TextInputAction.send,
                      onChanged: _onChanged,
                      onSubmitted: (_) => _send(),
                      decoration: InputDecoration(
                        hintText: 'Message',
                        isDense: true,
                        fillColor:
                            context.isDark ? const Color(0xFF2A3942) : Colors.white,
                        contentPadding:
                            const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
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
                  ),
                  const SizedBox(width: 6),
                  ValueListenableBuilder<TextEditingValue>(
                    valueListenable: _messageController,
                    builder: (context, value, _) {
                      final hasText = value.text.trim().isNotEmpty;
                      return CircleAvatar(
                        radius: 23,
                        backgroundColor: AppColors.green,
                        child: IconButton(
                          tooltip: 'Send',
                          icon: FaIcon(
                            hasText ? AppIcons.send : AppIcons.mic,
                            color: Colors.white,
                            size: 20,
                          ),
                          onPressed: hasText ? _send : _startRecording,
                        ),
                      );
                    },
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Replaces the composer while a voice note is being recorded.
  Widget _recordingBar(BuildContext context) {
    return Container(
      color: context.isDark ? const Color(0xFF202C33) : const Color(0xFFF0F2F5),
      child: SafeArea(
        top: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 1100),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'Cancel',
                    icon: const FaIcon(AppIcons.delete, color: Colors.redAccent),
                    onPressed: _isSendingRecording
                        ? null
                        : () => _finishRecording(send: false),
                  ),
                  const _RecordingDot(),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      _isSendingRecording
                          ? 'Sending…'
                          : 'Recording  ${_formatDuration(_recordDuration)}',
                      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                    ),
                  ),
                  FloatingActionButton(
                    mini: true,
                    tooltip: 'Send voice note',
                    backgroundColor: AppColors.green,
                    onPressed: _isSendingRecording
                        ? null
                        : () => _finishRecording(send: true),
                    child: _isSendingRecording
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const FaIcon(AppIcons.send, color: Colors.white, size: 18),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  static String _formatDuration(Duration d) {
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  void _showAttachmentSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const FaIcon(AppIcons.photo, color: Colors.purple),
              title: const Text('Photo'),
              onTap: () {
                Navigator.pop(sheetContext);
                _pickAndSend(ImageSource.gallery, 'image');
              },
            ),
            ListTile(
              leading: const FaIcon(AppIcons.video, color: Colors.red),
              title: const Text('Video'),
              onTap: () {
                Navigator.pop(sheetContext);
                _pickAndSend(ImageSource.gallery, 'video');
              },
            ),
            ListTile(
              leading: const FaIcon(AppIcons.camera, color: Colors.pink),
              title: const Text('Camera'),
              onTap: () {
                Navigator.pop(sheetContext);
                _pickAndSend(ImageSource.camera, 'image');
              },
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickAndSend(ImageSource source, String kind) async {
    try {
      final picker = ImagePicker();
      final XFile? file = kind == 'video'
          ? await picker.pickVideo(source: source)
          : await picker.pickImage(source: source, imageQuality: 85);

      if (file == null || !mounted) return;

      final bytes = await file.readAsBytes();
      if (!mounted) return;

      final messenger = ScaffoldMessenger.of(context);
      messenger.showSnackBar(const SnackBar(content: Text('Uploading…')));

      final ok = await context.read<ChatService>().sendMediaMessage(
            chatId: widget.chatId,
            bytes: bytes,
            filename: file.name,
            type: kind,
            mimeType: file.mimeType,
          );

      if (!mounted) return;
      messenger.hideCurrentSnackBar();
      if (!ok) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(context.read<ChatService>().errorMessage ?? 'Upload failed'),
          ),
        );
      }
      _scrollToBottom();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not pick a file: $e')),
      );
    }
  }

  void _showChatInfo(BuildContext context, ChatModel? chat) {
    if (chat == null) return;
    showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(chat.displayTitle(context.read<AuthService>().currentUserId)),
        content: SizedBox(
          width: 320,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (chat.isGroup)
                Text('Group · ${chat.participants.length} members')
              else
                Text(chat.otherParticipant(context.read<AuthService>().currentUserId)?.handle ?? ''),
              const SizedBox(height: 12),
              const Divider(),
              const SizedBox(height: 8),
              const Text('Members', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Flexible(
                child: SingleChildScrollView(
                  child: Column(
                    children: chat.participants
                        .map((p) => ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              leading: UserAvatar(
                                imageUrl: p.resolvedAvatarUrl,
                                initials: p.initials,
                                size: 34,
                                colorSeed: p.id,
                              ),
                              title: Text(p.displayName.isEmpty ? 'Unknown' : p.displayName),
                              subtitle: Text(p.handle),
                            ))
                        .toList(),
                  ),
                ),
              ),
            ],
          ),
        ),
        actions: [
          if (chat.isGroup)
            TextButton(
              onPressed: () {
                Navigator.pop(dialogContext);
                context.read<ChatService>().leaveGroup(chat.id);
              },
              child: const Text('Leave group'),
            ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }
}

/// Full-page wrapper used for phone navigation.
class ChatDetailScreen extends StatelessWidget {
  const ChatDetailScreen({super.key, required this.chatId});

  final String chatId;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: ChatDetailPane(
        chatId: chatId,
        onBack: () => Navigator.of(context).maybePop(),
      ),
    );
  }
}

/// Pulsing red dot shown while a voice note is being recorded.
class _RecordingDot extends StatefulWidget {
  const _RecordingDot();

  @override
  State<_RecordingDot> createState() => _RecordingDotState();
}

class _RecordingDotState extends State<_RecordingDot>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 700),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FadeTransition(
      opacity: _controller.drive(Tween(begin: 0.25, end: 1.0)),
      child: Container(
        width: 12,
        height: 12,
        decoration: const BoxDecoration(color: Colors.redAccent, shape: BoxShape.circle),
      ),
    );
  }
}
