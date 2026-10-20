import 'package:flutter/material.dart';

/// WhatsApp-inspired palette and Material 3 themes.
class AppColors {
  // Brand
  static const Color teal = Color(0xFF008069);
  static const Color tealDark = Color(0xFF075E54);
  static const Color green = Color(0xFF25D366);
  static const Color blueTick = Color(0xFF53BDEB);

  // Light
  static const Color lightBackground = Color(0xFFF7F5F2);
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightAppBar = Color(0xFF008069);
  static const Color chatBackground = Color(0xFFEFEAE2);
  static const Color bubbleOutLight = Color(0xFFD9FDD3);
  static const Color bubbleInLight = Color(0xFFFFFFFF);

  // Dark
  static const Color darkBackground = Color(0xFF0B141A);
  static const Color darkSurface = Color(0xFF111B21);
  static const Color darkAppBar = Color(0xFF202C33);
  static const Color darkChatBackground = Color(0xFF0B141A);
  static const Color bubbleOutDark = Color(0xFF005C4B);
  static const Color bubbleInDark = Color(0xFF202C33);

  static const Color online = Color(0xFF25D366);
}

/// Bubble/background colours that depend on brightness.
extension ChatThemeX on BuildContext {
  bool get isDark => Theme.of(this).brightness == Brightness.dark;
  Color get bubbleOut => isDark ? AppColors.bubbleOutDark : AppColors.bubbleOutLight;
  Color get bubbleIn => isDark ? AppColors.bubbleInDark : AppColors.bubbleInLight;
  Color get chatCanvas => isDark ? AppColors.darkChatBackground : AppColors.chatBackground;
  Color get panelColor => isDark ? AppColors.darkSurface : AppColors.lightSurface;
}

class AppTheme {
  static ThemeData lightTheme = _build(Brightness.light);
  static ThemeData darkTheme = _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.teal,
      brightness: brightness,
    ).copyWith(
      primary: isDark ? AppColors.teal : AppColors.teal,
      secondary: AppColors.green,
      surface: isDark ? AppColors.darkSurface : AppColors.lightSurface,
    );

    final appBarColor = isDark ? AppColors.darkAppBar : AppColors.lightAppBar;
    final backgroundColor =
        isDark ? AppColors.darkBackground : AppColors.lightBackground;

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: backgroundColor,
      appBarTheme: AppBarTheme(
        backgroundColor: appBarColor,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: false,
        iconTheme: const IconThemeData(color: Colors.white),
        titleTextStyle: const TextStyle(
          color: Colors.white,
          fontSize: 19,
          fontWeight: FontWeight.w600,
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.green,
        foregroundColor: Colors.white,
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: isDark ? AppColors.darkAppBar : Colors.white,
        selectedItemColor: isDark ? AppColors.green : AppColors.teal,
        unselectedItemColor: isDark ? Colors.white60 : Colors.black54,
        type: BottomNavigationBarType.fixed,
        showUnselectedLabels: true,
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: isDark ? AppColors.darkAppBar : Colors.white,
        selectedIconTheme: IconThemeData(color: isDark ? AppColors.green : AppColors.teal),
        unselectedIconTheme: IconThemeData(color: isDark ? Colors.white60 : Colors.black54),
        selectedLabelTextStyle: TextStyle(
          color: isDark ? AppColors.green : AppColors.teal,
          fontSize: 12,
        ),
        indicatorColor: (isDark ? AppColors.green : AppColors.teal).withValues(alpha: 0.15),
      ),
      dividerTheme: DividerThemeData(
        color: isDark ? Colors.white12 : Colors.black12,
        thickness: 0.6,
        space: 0.6,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AppColors.darkSurface : Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: isDark ? Colors.white24 : Colors.black26),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: isDark ? Colors.white24 : Colors.black26),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: isDark ? AppColors.green : AppColors.teal, width: 1.6),
        ),
      ),
      listTileTheme: ListTileThemeData(
        iconColor: isDark ? Colors.white70 : Colors.black54,
        textColor: isDark ? Colors.white : Colors.black87,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isDark ? AppColors.darkAppBar : const Color(0xFF2A3942),
        contentTextStyle: const TextStyle(color: Colors.white),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      cardTheme: CardThemeData(
        color: isDark ? AppColors.darkSurface : Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: isDark ? AppColors.green : AppColors.teal,
      ),
    );
  }
}
