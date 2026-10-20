import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Whether videos can be played *inside* the app on this platform.
///
/// `video_player` supports Android, iOS and web. On desktop there is no
/// official implementation, so those platforms hand the file to the system
/// player instead.
bool get supportsInlineVideo {
  if (kIsWeb) return true;
  switch (defaultTargetPlatform) {
    case TargetPlatform.android:
    case TargetPlatform.iOS:
      return true;
    default:
      return false;
  }
}

/// Full-screen in-app video player.
class VideoPlayerScreen extends StatefulWidget {
  const VideoPlayerScreen({super.key, required this.url, this.title});

  final String url;
  final String? title;

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  VideoPlayerController? _controller;
  bool _initialising = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _initialise();
  }

  Future<void> _initialise() async {
    try {
      final controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
      await controller.initialize();
      await controller.setLooping(false);
      if (!mounted) {
        controller.dispose();
        return;
      }
      setState(() {
        _controller = controller;
        _initialising = false;
      });
      await controller.play();
    } catch (e) {
      debugPrint('Video playback failed: $e');
      if (mounted) {
        setState(() {
          _initialising = false;
          _error = 'This video could not be played.';
        });
      }
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        elevation: 0,
        title: Text(
          widget.title?.isNotEmpty == true ? widget.title! : 'Video',
          style: const TextStyle(fontSize: 16),
        ),
      ),
      body: Center(child: _body()),
    );
  }

  Widget _body() {
    if (_initialising) {
      return const SizedBox(
        width: 36,
        height: 36,
        child: CircularProgressIndicator(color: Colors.white),
      );
    }

    if (_error != null || _controller == null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const FaIcon(AppIcons.videoOff, color: Colors.white54, size: 64),
            const SizedBox(height: 14),
            Text(
              _error ?? 'Video unavailable',
              style: const TextStyle(color: Colors.white70),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      );
    }

    final controller = _controller!;

    // Fit the video inside whatever space is available instead of forcing an
    // AspectRatio directly in a Column — with a portrait clip that overflowed
    // and the picture came out cropped or squashed.
    return Column(
      children: [
        Expanded(
          child: Center(
            child: ValueListenableBuilder<VideoPlayerValue>(
              valueListenable: controller,
              builder: (context, value, __) {
                final aspect = value.aspectRatio > 0 ? value.aspectRatio : 16 / 9;

                return AspectRatio(
                  aspectRatio: aspect,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      VideoPlayer(controller),
                      if (value.isBuffering)
                        const CircularProgressIndicator(color: Colors.white),
                      // Big tap target that toggles play/pause over the video.
                      Positioned.fill(
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: () => value.isPlaying
                              ? controller.pause()
                              : controller.play(),
                          child: const SizedBox.expand(),
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
        const SizedBox(height: 8),
        ValueListenableBuilder<VideoPlayerValue>(
          valueListenable: controller,
          builder: (context, value, _) {
            final position = value.position;
            final total = value.duration;

            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                children: [
                  VideoProgressIndicator(
                    controller,
                    allowScrubbing: true,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    colors: const VideoProgressColors(
                      playedColor: Color(0xFF25D366),
                      bufferedColor: Colors.white24,
                      backgroundColor: Colors.white12,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      IconButton(
                        iconSize: 38,
                        color: Colors.white,
                        icon: FaIcon(
                          value.isPlaying
                              ? AppIcons.pause
                              : AppIcons.play,
                        ),
                        onPressed: () =>
                            value.isPlaying ? controller.pause() : controller.play(),
                      ),
                      Text(
                        '${_fmt(position)} / ${_fmt(total)}',
                        style: const TextStyle(color: Colors.white70, fontSize: 13),
                      ),
                      const Spacer(),
                      IconButton(
                        color: Colors.white,
                        icon: const FaIcon(AppIcons.replay),
                        onPressed: () => controller.seekTo(
                          position - const Duration(seconds: 10),
                        ),
                      ),
                      IconButton(
                        color: Colors.white,
                        icon: const FaIcon(AppIcons.forward),
                        onPressed: () => controller.seekTo(
                          position + const Duration(seconds: 10),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }

  static String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$m:$s';
  }
}
