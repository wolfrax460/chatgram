import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../core/theme.dart';
import '../models/message_model.dart';
import 'media_viewer.dart';
import 'message_ticks.dart';
import 'video_player_screen.dart';
import 'voice_note_player.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// A single WhatsApp-style chat bubble.
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    super.key,
    required this.message,
    required this.isMine,
    required this.status,
    this.senderName,
    this.showSenderName = false,
    this.maxWidthFraction = 0.72,
    this.onRetry,
  });

  final MessageModel message;
  final bool isMine;
  final MessageStatus status;
  final String? senderName;
  final bool showSenderName;
  final double maxWidthFraction;
  final VoidCallback? onRetry;

  static final _time = DateFormat.jm();

  @override
  Widget build(BuildContext context) {
    final bubbleColor = isMine ? context.bubbleOut : context.bubbleIn;
    final textColor = Theme.of(context).brightness == Brightness.dark
        ? Colors.white
        : Colors.black87;

    final maxWidth = MediaQuery.sizeOf(context).width * maxWidthFraction;

    return Align(
      alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth.clamp(200.0, 620.0)),
        child: Padding(
          padding: EdgeInsets.only(
            left: isMine ? 40 : 8,
            right: isMine ? 8 : 40,
            top: 2,
            bottom: 2,
          ),
          child: _BubbleShell(
            color: bubbleColor,
            isMine: isMine,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (showSenderName && !isMine && (senderName?.isNotEmpty ?? false))
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      senderName!,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.teal,
                      ),
                    ),
                  ),
                _content(context, textColor),
                const SizedBox(height: 4),
                _meta(context, textColor),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _content(BuildContext context, Color textColor) {
    switch (message.type) {
      case MessageType.image:
        return _ImageContent(message: message, textColor: textColor);
      case MessageType.video:
        return _AttachmentTile(
          message: message,
          icon: AppIcons.play,
          label: 'Video',
          hint: supportsInlineVideo ? 'Tap to play' : 'Tap to open in your player',
          textColor: textColor,
          caption: message.content,
          onTap: () => _openVideo(context, message),
        );
      case MessageType.audio:
        return VoiceNotePlayer(
          url: message.resolvedMediaUrl,
          isMine: isMine,
          textColor: textColor,
          onOpenExternal: () => openMediaExternally(context, message.resolvedMediaUrl),
        );
      case MessageType.file:
        return _AttachmentTile(
          message: message,
          icon: AppIcons.file,
          label: message.content?.isNotEmpty == true ? message.content! : 'Document',
          hint: 'Tap to open',
          textColor: textColor,
          onTap: () => openMediaExternally(context, message.resolvedMediaUrl),
        );
      case MessageType.text:
        return Text(
          message.content ?? '',
          style: TextStyle(fontSize: 15.5, height: 1.32, color: textColor),
        );
    }
  }

  Widget _meta(BuildContext context, Color textColor) {
    final muted = textColor.withValues(alpha: 0.55);
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        if (status == MessageStatus.failed && onRetry != null)
          GestureDetector(
            onTap: onRetry,
            child: Padding(
              padding: const EdgeInsets.only(right: 6),
              child: Text(
                'Retry',
                style: TextStyle(
                  fontSize: 11.5,
                  color: Theme.of(context).colorScheme.error,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        Text(
          _time.format(message.sentAt),
          style: TextStyle(fontSize: 11, color: muted),
        ),
        if (isMine) ...[
          const SizedBox(width: 4),
          MessageTicks(status: status),
        ],
      ],
    );
  }
}

/// Inline image with a loading/error state; tapping opens the full-screen viewer.
class _ImageContent extends StatelessWidget {
  const _ImageContent({required this.message, required this.textColor});

  final MessageModel message;
  final Color textColor;

  @override
  Widget build(BuildContext context) {
    final url = message.resolvedMediaUrl;
    final heroTag = 'img-${message.id}';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: GestureDetector(
            onTap: url.isEmpty
                ? null
                : () => showImageViewer(
                      context,
                      url: url,
                      heroTag: heroTag,
                      caption: message.content,
                    ),
            child: SizedBox(
              width: 240,
              height: 190,
              child: url.isEmpty
                  ? const _MediaPlaceholder(icon: AppIcons.photo)
                  : Hero(
                      tag: heroTag,
                      child: Image.network(
                        url,
                        fit: BoxFit.cover,
                        loadingBuilder: (context, child, progress) => progress == null
                            ? child
                            : const _MediaPlaceholder(loading: true),
                        errorBuilder: (_, __, ___) => const _MediaPlaceholder(
                          icon: AppIcons.brokenImage,
                          label: 'Image unavailable',
                        ),
                      ),
                    ),
            ),
          ),
        ),
        if (message.content?.trim().isNotEmpty ?? false)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              message.content!,
              style: TextStyle(fontSize: 15, color: textColor),
            ),
          ),
      ],
    );
  }
}

/// Plays a video in-app where the platform supports it, otherwise hands it to
/// the system player. This is what stops Android from only offering a download.
Future<void> _openVideo(BuildContext context, MessageModel message) async {
  final url = message.resolvedMediaUrl;
  if (url.isEmpty) return;

  if (supportsInlineVideo) {
    await Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => VideoPlayerScreen(url: url),
      ),
    );
    return;
  }
  await openMediaExternally(context, url);
}

/// Video / document tile — tapping opens the media.
class _AttachmentTile extends StatelessWidget {
  const _AttachmentTile({
    required this.message,
    required this.icon,
    required this.label,
    required this.hint,
    required this.textColor,
    this.caption,
    this.onTap,
  });

  final MessageModel message;
  final FaIconData icon;
  final String label;
  final String hint;
  final Color textColor;
  final String? caption;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(8),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 240,
              height: 150,
              child: ColoredBox(
                color: Colors.black.withValues(alpha: 0.18),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    FaIcon(icon, size: 44, color: Colors.white70),
                    const SizedBox(height: 8),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      child: Text(
                        label,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: Colors.white, fontSize: 13.5),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      hint,
                      style: const TextStyle(color: Colors.white60, fontSize: 11.5),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        if (message.type != MessageType.file &&
            (caption?.trim().isNotEmpty ?? false))
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(caption!, style: TextStyle(fontSize: 15, color: textColor)),
          ),
      ],
    );
  }
}

class _MediaPlaceholder extends StatelessWidget {
  const _MediaPlaceholder({this.icon, this.label, this.loading = false});

  final FaIconData? icon;
  final String? label;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: Colors.black.withValues(alpha: 0.15),
      child: Center(
        child: loading
            ? const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white70),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  FaIcon(icon ?? AppIcons.photo, size: 38, color: Colors.white70),
                  if (label != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      label!,
                      style: const TextStyle(color: Colors.white70, fontSize: 12),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

/// Rounded container with the characteristic little tail on the sender side.
class _BubbleShell extends StatelessWidget {
  const _BubbleShell({required this.color, required this.isMine, required this.child});

  final Color color;
  final bool isMine;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    const radius = Radius.circular(12);
    const tail = Radius.circular(2);

    return CustomPaint(
      painter: _TailPainter(color: color, isMine: isMine),
      child: Container(
        margin: const EdgeInsets.only(top: 6),
        padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.only(
            topLeft: isMine ? radius : tail,
            topRight: isMine ? tail : radius,
            bottomLeft: radius,
            bottomRight: radius,
          ),
        ),
        child: child,
      ),
    );
  }
}

class _TailPainter extends CustomPainter {
  _TailPainter({required this.color, required this.isMine});

  final Color color;
  final bool isMine;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final path = Path();
    const w = 8.0;
    const h = 13.0;
    if (isMine) {
      path.moveTo(size.width, 0);
      path.lineTo(size.width + w, 0);
      path.lineTo(size.width, h);
    } else {
      path.moveTo(0, 0);
      path.lineTo(-w, 0);
      path.lineTo(0, h);
    }
    path.close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _TailPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.isMine != isMine;
}
