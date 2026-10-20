import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Full-screen, pinch-to-zoom image viewer used when a chat image is tapped.
Future<void> showImageViewer(
  BuildContext context, {
  required String url,
  String? heroTag,
  String? caption,
}) {
  return Navigator.of(context).push(
    MaterialPageRoute(
      fullscreenDialog: true,
      builder: (_) => _ImageViewerScreen(url: url, heroTag: heroTag, caption: caption),
    ),
  );
}

/// Open a media URL in the platform's own handler (browser, video player,
/// document viewer). This is how video and audio attachments are opened on
/// platforms where inline playback is not available.
Future<bool> openMediaExternally(BuildContext context, String url) async {
  final uri = Uri.tryParse(url);
  if (uri == null) return false;

  try {
    final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!launched && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open this attachment')),
      );
    }
    return launched;
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open this attachment: $e')),
      );
    }
    return false;
  }
}

class _ImageViewerScreen extends StatelessWidget {
  const _ImageViewerScreen({required this.url, this.heroTag, this.caption});

  final String url;
  final String? heroTag;
  final String? caption;

  @override
  Widget build(BuildContext context) {
    final image = InteractiveViewer(
      minScale: 1,
      maxScale: 5,
      child: Image.network(
        url,
        fit: BoxFit.contain,
        loadingBuilder: (context, child, progress) => progress == null
            ? child
            : const Center(
                child: SizedBox(
                  width: 34,
                  height: 34,
                  child: CircularProgressIndicator(color: Colors.white),
                ),
              ),
        errorBuilder: (_, __, ___) => const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              FaIcon(AppIcons.brokenImage, color: Colors.white54, size: 64),
              SizedBox(height: 12),
              Text(
                'This image could not be loaded',
                style: TextStyle(color: Colors.white70),
              ),
            ],
          ),
        ),
      ),
    );

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        elevation: 0,
        actions: [
          IconButton(
            tooltip: 'Open in browser',
            icon: const FaIcon(AppIcons.openExternal),
            onPressed: () => openMediaExternally(context, url),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: heroTag == null
                ? image
                : Hero(tag: heroTag!, child: image),
          ),
          if (caption != null && caption!.trim().isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
              child: Text(
                caption!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white, fontSize: 15),
              ),
            ),
        ],
      ),
    );
  }
}
