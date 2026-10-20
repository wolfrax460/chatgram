import 'package:flutter/widgets.dart';

/// Layout breakpoints used to switch between phone, tablet and desktop layouts.
///
/// Kept in one place so every screen agrees on where the layout changes, and so
/// the web build degrades gracefully from a 320px phone to an ultrawide monitor.
class Breakpoints {
  /// Below this width: single pane, compact spacing.
  static const double compact = 600;

  /// At/above this width we show the WhatsApp-Web style three-pane layout.
  static const double wide = 900;

  /// Above this the chat list stops growing and content is centred, so the app
  /// does not stretch into unreadable 2000px-wide rows on a big monitor.
  static const double ultrawide = 1600;

  /// Preferred width of the chat list column in the wide layout.
  static const double chatListWidth = 380;

  /// Hard cap for list/reading content on very large screens.
  static const double maxContentWidth = 980;

  static double width(BuildContext context) => MediaQuery.sizeOf(context).width;

  static bool isCompact(BuildContext context) => width(context) < compact;

  static bool isWide(BuildContext context) => width(context) >= wide;

  static bool isUltrawide(BuildContext context) => width(context) >= ultrawide;

  /// The chat list column width for the current screen.
  ///
  /// A fixed 380px is comfortable on a laptop, wasteful on a 1280px window and
  /// cramped at 900px, so scale it and give the remaining width to the chat.
  static double chatListPaneWidth(BuildContext context) {
    final w = width(context);
    if (w >= 1400) return 420;
    if (w >= 1100) return 400;
    return 340;
  }

  /// Horizontal padding that shrinks on small screens and grows on large ones.
  static double pagePadding(BuildContext context) {
    final w = width(context);
    if (w < compact) return 16;
    if (w < wide) return 24;
    return 32;
  }
}

/// Centres content and caps its width on very large screens.
///
/// Wrap list/reading screens with this so full-bleed rows on a 1440p monitor
/// become a comfortable column instead of a 2000px line of text.
class MaxContentWidth extends StatelessWidget {
  const MaxContentWidth({super.key, required this.child, this.maxWidth});

  final Widget child;
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: maxWidth ?? Breakpoints.maxContentWidth,
        ),
        child: child,
      ),
    );
  }
}
