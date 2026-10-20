import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../../../core/theme.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Where the app is running — used to tailor the welcome screen copy, the way
/// WhatsApp shows a different first screen on Android, desktop and web.
enum AppPlatform { android, ios, windows, macos, linux, web }

AppPlatform currentAppPlatform() {
  if (kIsWeb) return AppPlatform.web;
  switch (defaultTargetPlatform) {
    case TargetPlatform.android:
      return AppPlatform.android;
    case TargetPlatform.iOS:
      return AppPlatform.ios;
    case TargetPlatform.windows:
      return AppPlatform.windows;
    case TargetPlatform.macOS:
      return AppPlatform.macos;
    case TargetPlatform.linux:
      return AppPlatform.linux;
    default:
      return AppPlatform.web;
  }
}

class _PlatformCopy {
  const _PlatformCopy({
    required this.label,
    required this.headline,
    required this.subtitle,
    required this.bullets,
    required this.icon,
  });

  final String label;
  final String headline;
  final String subtitle;
  final List<String> bullets;
  final FaIconData icon;
}

_PlatformCopy _copyFor(AppPlatform platform) {
  switch (platform) {
    case AppPlatform.android:
      return const _PlatformCopy(
        label: 'Android app',
        headline: 'Simple. Reliable. Private messaging.',
        subtitle: 'Chatgram runs natively on your Android phone.',
        bullets: [
          'Chat one-to-one or in groups',
          'Share photos, videos and voice notes',
          'Status updates that vanish after 24 hours',
        ],
        icon: AppIcons.android,
      );
    case AppPlatform.ios:
      return const _PlatformCopy(
        label: 'iOS app',
        headline: 'Simple. Reliable. Private messaging.',
        subtitle: 'Chatgram runs natively on your iPhone and iPad.',
        bullets: [
          'Chat one-to-one or in groups',
          'Share photos, videos and voice notes',
          'Status updates that vanish after 24 hours',
        ],
        icon: AppIcons.mobile,
      );
    case AppPlatform.windows:
      return const _PlatformCopy(
        label: 'Windows desktop',
        headline: 'Chatgram for Windows',
        subtitle: 'A full desktop experience with a wide, three-pane layout.',
        bullets: [
          'Chat list and conversation side by side',
          'Drag-and-drop friendly, keyboard ready',
          'Same account as your phone and the web',
        ],
        icon: AppIcons.windows,
      );
    case AppPlatform.macos:
      return const _PlatformCopy(
        label: 'macOS desktop',
        headline: 'Chatgram for Mac',
        subtitle: 'A full desktop experience built for a large screen.',
        bullets: [
          'Chat list and conversation side by side',
          'Native window controls',
          'Same account as your phone and the web',
        ],
        icon: AppIcons.laptop,
      );
    case AppPlatform.linux:
      return const _PlatformCopy(
        label: 'Linux desktop',
        headline: 'Chatgram for Linux',
        subtitle: 'A full desktop experience built for a large screen.',
        bullets: [
          'Chat list and conversation side by side',
          'Runs on any modern distribution',
          'Same account as your phone and the web',
        ],
        icon: AppIcons.laptop,
      );
    case AppPlatform.web:
      return const _PlatformCopy(
        label: 'Web browser',
        headline: 'Chatgram Web',
        subtitle: 'Nothing to install — message straight from your browser.',
        bullets: [
          'Works in Chrome, Edge, Firefox and Safari',
          'Open a second tab or window to chat with yourself',
          'Your session is remembered on this device',
        ],
        icon: AppIcons.globe,
      );
  }
}

/// WhatsApp-style welcome screen shown the first time the app is opened on a
/// device. Responsive: a centred card on phones, a two-column hero on desktop.
class LandingScreen extends StatelessWidget {
  const LandingScreen({
    super.key,
    required this.onContinue,
    required this.onCreateAccount,
  });

  final VoidCallback onContinue;
  final VoidCallback onCreateAccount;

  @override
  Widget build(BuildContext context) {
    final platform = currentAppPlatform();
    final copy = _copyFor(platform);
    final isWide = MediaQuery.sizeOf(context).width >= 900;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      backgroundColor: isDark ? AppColors.darkBackground : Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 1180),
              child: isWide
                  ? Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Expanded(child: _hero(context, copy, compact: false)),
                        Expanded(
                          child: Padding(
                            padding: const EdgeInsets.all(48),
                            child: _actions(context, copy),
                          ),
                        ),
                      ],
                    )
                  : Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _hero(context, copy, compact: true),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
                          child: _actions(context, copy),
                        ),
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _hero(BuildContext context, _PlatformCopy copy, {required bool compact}) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.symmetric(
        horizontal: compact ? 28 : 56,
        vertical: compact ? 52 : 72,
      ),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.tealDark, AppColors.teal, AppColors.green],
        ),
        borderRadius: compact
            ? const BorderRadius.vertical(bottom: Radius.circular(28))
            : BorderRadius.zero,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: compact ? CrossAxisAlignment.center : CrossAxisAlignment.start,
        children: [
          const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(
                radius: 30,
                backgroundColor: Colors.white,
                child: FaIcon(AppIcons.chat, size: 34, color: AppColors.teal),
              ),
              SizedBox(width: 14),
              Text(
                'Chatgram',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 30,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 26),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.18),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                FaIcon(copy.icon, size: 16, color: Colors.white),
                const SizedBox(width: 8),
                Text(
                  copy.label,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Text(
            copy.headline,
            textAlign: compact ? TextAlign.center : TextAlign.start,
            style: TextStyle(
              color: Colors.white,
              fontSize: compact ? 26 : 34,
              height: 1.2,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            copy.subtitle,
            textAlign: compact ? TextAlign.center : TextAlign.start,
            style: TextStyle(
              color: Colors.white.withValues(alpha: 0.9),
              fontSize: 15.5,
              height: 1.4,
            ),
          ),
          if (compact) const SizedBox(height: 8),
        ],
      ),
    );
  }

  Widget _actions(BuildContext context, _PlatformCopy copy) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        ...copy.bullets.map(
          (text) => Padding(
            padding: const EdgeInsets.only(bottom: 14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const FaIcon(AppIcons.verified, color: AppColors.green, size: 22),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    text,
                    style: TextStyle(
                      fontSize: 15,
                      height: 1.35,
                      color: isDark ? Colors.white70 : Colors.black87,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: onContinue,
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.green,
            minimumSize: const Size.fromHeight(52),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
          ),
          child: const Text(
            'Agree and continue',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
        ),
        const SizedBox(height: 12),
        OutlinedButton(
          onPressed: onCreateAccount,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size.fromHeight(52),
            foregroundColor: AppColors.teal,
            side: const BorderSide(color: AppColors.teal),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
          ),
          child: const Text(
            'Create a new account',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
          ),
        ),
        const SizedBox(height: 22),
        Text(
          'By continuing you agree to the Terms of Service and Privacy Policy.',
          textAlign: TextAlign.center,
          style: TextStyle(
            fontSize: 12,
            height: 1.4,
            color: isDark ? Colors.white38 : Colors.black45,
          ),
        ),
      ],
    );
  }
}
