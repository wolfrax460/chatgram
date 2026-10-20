import 'dart:async';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Inline voice-note player used inside chat bubbles.
///
/// Uses `audioplayers`, which supports web, Android and Windows.
class VoiceNotePlayer extends StatefulWidget {
  const VoiceNotePlayer({
    super.key,
    required this.url,
    required this.isMine,
    this.textColor,
    this.onOpenExternal,
  });

  final String url;
  final bool isMine;
  final Color? textColor;
  final VoidCallback? onOpenExternal;

  @override
  State<VoiceNotePlayer> createState() => _VoiceNotePlayerState();
}

class _VoiceNotePlayerState extends State<VoiceNotePlayer> {
  final AudioPlayer _player = AudioPlayer();
  final List<StreamSubscription> _subs = [];

  bool _isPlaying = false;
  bool _isLoading = false;
  Duration _position = Duration.zero;
  Duration _duration = Duration.zero;
  String? _error;

  @override
  void initState() {
    super.initState();
    _subs.add(_player.onPositionChanged.listen((p) {
      if (mounted) setState(() => _position = p);
    }));
    _subs.add(_player.onDurationChanged.listen((d) {
      if (mounted) setState(() => _duration = d);
    }));
    _subs.add(_player.onPlayerStateChanged.listen((state) {
      if (!mounted) return;
      setState(() => _isPlaying = state == PlayerState.playing);
    }));
    _subs.add(_player.onPlayerComplete.listen((_) {
      if (!mounted) return;
      setState(() {
        _isPlaying = false;
        _position = Duration.zero;
      });
    }));
  }

  @override
  void dispose() {
    for (final sub in _subs) {
      sub.cancel();
    }
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_isPlaying) {
      await _player.pause();
      return;
    }

    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      if (_position > Duration.zero && _position < _duration) {
        await _player.resume();
      } else {
        await _player.play(UrlSource(widget.url));
      }
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not play this voice note');
      debugPrint('Voice note playback error: $e');
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  static String _fmt(Duration d) {
    final minutes = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final seconds = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  @override
  Widget build(BuildContext context) {
    final tint = widget.textColor ?? Colors.black87;
    final total = _duration.inMilliseconds == 0 ? 1 : _duration.inMilliseconds;
    final progress = (_position.inMilliseconds / total).clamp(0.0, 1.0);

    if (_error != null) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const FaIcon(AppIcons.error, size: 20, color: Colors.redAccent),
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              _error!,
              style: TextStyle(fontSize: 13.5, color: tint),
            ),
          ),
          if (widget.onOpenExternal != null)
            IconButton(
              tooltip: 'Open externally',
              icon: FaIcon(AppIcons.openExternal, size: 18, color: tint),
              onPressed: widget.onOpenExternal,
            ),
        ],
      );
    }

    return SizedBox(
      width: 210,
      child: Row(
        children: [
          IconButton(
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            icon: _isLoading
                ? SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: tint),
                  )
                : FaIcon(
                    _isPlaying ? AppIcons.pause : AppIcons.play,
                    size: 34,
                  ),
            color: tint,
            onPressed: _toggle,
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                SliderTheme(
                  data: SliderTheme.of(context).copyWith(
                    trackHeight: 2.5,
                    thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 5),
                    overlayShape: const RoundSliderOverlayShape(overlayRadius: 10),
                    activeTrackColor: tint,
                    inactiveTrackColor: tint.withValues(alpha: 0.3),
                    thumbColor: tint,
                  ),
                  child: Slider(
                    value: progress,
                    onChanged: (value) {
                      final target = Duration(
                        milliseconds: (value * _duration.inMilliseconds).round(),
                      );
                      setState(() => _position = target);
                      _player.seek(target);
                    },
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.only(left: 2),
                  child: Text(
                    _duration == Duration.zero
                        ? 'Voice message'
                        : '${_fmt(_position)} / ${_fmt(_duration)}',
                    style: TextStyle(fontSize: 11, color: tint.withValues(alpha: 0.7)),
                  ),
                ),
              ],
            ),
          ),
          FaIcon(AppIcons.mic, size: 16, color: tint.withValues(alpha: 0.55)),
        ],
      ),
    );
  }
}
