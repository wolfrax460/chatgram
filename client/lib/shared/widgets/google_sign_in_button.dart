import 'package:flutter/material.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// "Continue with Google" button.
///
/// Only rendered when the server reports Google OAuth is configured, so the
/// button never appears and then fails.
class GoogleSignInButton extends StatelessWidget {
  const GoogleSignInButton({
    super.key,
    required this.onPressed,
    this.label = 'Continue with Google',
    this.isLoading = false,
  });

  final VoidCallback? onPressed;
  final String label;
  final bool isLoading;

  static const _googleBlue = Color(0xFF4285F4);

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return SizedBox(
      height: 50,
      child: OutlinedButton(
        onPressed: isLoading ? null : onPressed,
        style: OutlinedButton.styleFrom(
          backgroundColor: isDark ? const Color(0xFF1F1F1F) : Colors.white,
          foregroundColor: isDark ? Colors.white : const Color(0xFF3C4043),
          side: BorderSide(color: isDark ? Colors.white24 : const Color(0xFFDADCE0)),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
        child: isLoading
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2.2),
              )
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Google's mark: a "G" in Google blue. Using the official
                  // multi-colour logo asset would be preferable for production
                  // branding — see https://about.google/brand-resource-center/
                  const Text(
                    'G',
                    style: TextStyle(
                      color: _googleBlue,
                      fontSize: 21,
                      fontWeight: FontWeight.w700,
                      height: 1,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Text(
                    label,
                    style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
      ),
    );
  }
}

/// Shown in place of the Google button when the server HAS Google configured
/// but the flow cannot complete on this device (typically a phone talking to a
/// LAN address while Google redirects to localhost).
///
/// Better to explain than to offer a button that silently times out for three
/// minutes.
class GoogleUnavailableNote extends StatelessWidget {
  const GoogleUnavailableNote({super.key, required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: scheme.outlineVariant),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FaIcon(AppIcons.info, size: 18, color: scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              message,
              style: TextStyle(fontSize: 12.5, height: 1.35, color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }
}

/// "─────── or ───────" separator used between Google and email sign-in.
class OrDivider extends StatelessWidget {
  const OrDivider({super.key, this.label = 'or'});

  final String label;

  @override
  Widget build(BuildContext context) {
    final colour = Theme.of(context).dividerColor;
    return Row(
      children: [
        Expanded(child: Divider(color: colour)),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12.5,
              color: Theme.of(context).textTheme.bodySmall?.color,
            ),
          ),
        ),
        Expanded(child: Divider(color: colour)),
      ],
    );
  }
}
