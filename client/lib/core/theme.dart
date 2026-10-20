import 'package:flutter/material.dart';

/// Chatgram design tokens.
///
/// These mirror the Tailwind palette used by the React web client
/// (`client/webapp/tailwind.config.js`) so both apps look like one product:
/// the same brand greens, the same ink greys, the same corner radii and the
/// same soft "surface + hairline" treatment instead of heavy Material elevation.
class AppColors {
  // ---------------------------------------------------------------- brand
  static const Color brand50 = Color(0xFFE6F4F1);
  static const Color brand100 = Color(0xFFC2E5DD);
  static const Color brand200 = Color(0xFF9AD4C8);
  static const Color brand300 = Color(0xFF6EC2B1);
  static const Color brand400 = Color(0xFF4BB49F);
  static const Color brand500 = Color(0xFF26A68E);
  static const Color brand600 = Color(0xFF008069);
  static const Color brand700 = Color(0xFF066353);
  static const Color brand800 = Color(0xFF0A4C41);
  static const Color brand900 = Color(0xFF0B3A33);

  /// The single accent used for primary actions.
  static const Color brand = brand600;

  // ------------------------------------------------------------------ ink
  static const Color ink50 = Color(0xFFF7F9FA);
  static const Color ink100 = Color(0xFFE9EDEF);
  static const Color ink200 = Color(0xFFD1D7DB);
  static const Color ink300 = Color(0xFFAEBAC1);
  static const Color ink400 = Color(0xFF8696A0);
  static const Color ink500 = Color(0xFF667781);
  static const Color ink600 = Color(0xFF3B4A54);
  static const Color ink700 = Color(0xFF202C33);
  static const Color ink800 = Color(0xFF111B21);
  static const Color ink900 = Color(0xFF0B141A);

  // -------------------------------------------------------------- aliases
  static const Color teal = brand600;
  static const Color tealDark = brand700;
  static const Color green = Color(0xFF25D366);
  static const Color blueTick = Color(0xFF53BDEB);
  static const Color online = Color(0xFF25D366);

  static const Color lightBackground = ink50;
  static const Color lightSurface = Color(0xFFFFFFFF);
  static const Color lightAppBar = Color(0xFFFFFFFF);
  static const Color chatBackground = Color(0xFFEFEAE2);
  static const Color bubbleOutLight = Color(0xFFD9FDD3);
  static const Color bubbleInLight = Color(0xFFFFFFFF);

  static const Color darkBackground = ink900;
  static const Color darkSurface = ink800;
  static const Color darkAppBar = ink800;
  static const Color darkChatBackground = ink900;
  static const Color bubbleOutDark = Color(0xFF005C4B);
  static const Color bubbleInDark = ink700;

  // --------------------------------------------------------------- layout
  /// Card / section radius (Tailwind `rounded-2xl`).
  static const double radius = 16;

  /// Input + button radius (Tailwind `rounded-xl`).
  static const double radiusSm = 12;

  // ------------------------------------------------------------- hairline
  static const Color lightHairline = Color(0xFFE3E9E7);
  static const Color darkHairline = Color(0xFF22303A);
}

/// Colours that depend on brightness.
extension ChatThemeX on BuildContext {
  bool get isDark => Theme.of(this).brightness == Brightness.dark;

  Color get bubbleOut =>
      isDark ? AppColors.bubbleOutDark : AppColors.bubbleOutLight;

  Color get bubbleIn =>
      isDark ? AppColors.bubbleInDark : AppColors.bubbleInLight;

  Color get chatCanvas =>
      isDark ? AppColors.darkChatBackground : AppColors.chatBackground;

  Color get panelColor =>
      isDark ? AppColors.darkSurface : AppColors.lightSurface;

  /// Hairline border matching the web client's `border-ink-200`.
  Color get hairline =>
      isDark ? AppColors.darkHairline : AppColors.lightHairline;

  /// Muted secondary text.
  Color get mutedText =>
      isDark ? AppColors.ink400 : AppColors.ink500;
}

class AppTheme {
  static ThemeData lightTheme = _build(Brightness.light);
  static ThemeData darkTheme = _build(Brightness.dark);

  static RoundedRectangleBorder _rounded(double r) =>
      RoundedRectangleBorder(borderRadius: BorderRadius.circular(r));

  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    final background = isDark ? AppColors.ink900 : AppColors.ink50;
    final surface = isDark ? AppColors.ink800 : Colors.white;
    final onSurface = isDark ? AppColors.ink100 : AppColors.ink800;
    final muted = isDark ? AppColors.ink400 : AppColors.ink500;
    final hairline = isDark ? AppColors.darkHairline : AppColors.lightHairline;

    final scheme = ColorScheme.fromSeed(
      seedColor: AppColors.brand600,
      brightness: brightness,
    ).copyWith(
      primary: AppColors.brand600,
      onPrimary: Colors.white,
      secondary: AppColors.green,
      surface: surface,
      onSurface: onSurface,
      error: const Color(0xFFE5484D),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,

      // The web client uses a *surface* header with a hairline, not a solid
      // coloured bar. Matching that is what makes the two apps feel related.
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: onSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: onSurface, size: 22),
        titleTextStyle: TextStyle(
          color: onSurface,
          fontSize: 19,
          fontWeight: FontWeight.w700,
          letterSpacing: -0.2,
        ),
      ),

      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: AppColors.brand600,
        foregroundColor: Colors.white,
        elevation: 2,
        shape: _rounded(16),
      ),

      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: surface,
        selectedItemColor: AppColors.brand600,
        unselectedItemColor: muted,
        type: BottomNavigationBarType.fixed,
        showUnselectedLabels: true,
        elevation: 0,
        selectedLabelStyle:
            const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700),
        unselectedLabelStyle: const TextStyle(fontSize: 11.5),
      ),

      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: surface,
        selectedIconTheme: const IconThemeData(color: AppColors.brand600),
        unselectedIconTheme: IconThemeData(color: muted),
        selectedLabelTextStyle: const TextStyle(
          color: AppColors.brand600,
          fontSize: 12,
          fontWeight: FontWeight.w700,
        ),
        unselectedLabelTextStyle: TextStyle(color: muted, fontSize: 12),
        indicatorColor: AppColors.brand600.withValues(alpha: 0.12),
        indicatorShape: _rounded(12),
      ),

      dividerTheme: DividerThemeData(color: hairline, thickness: 1, space: 1),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? AppColors.ink800 : Colors.white,
        hintStyle: TextStyle(color: muted, fontSize: 14.5),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppColors.radiusSm),
          borderSide: BorderSide(color: hairline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppColors.radiusSm),
          borderSide: BorderSide(color: hairline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppColors.radiusSm),
          borderSide: const BorderSide(color: AppColors.brand600, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppColors.radiusSm),
          borderSide: BorderSide(color: scheme.error),
        ),
      ),

      listTileTheme: ListTileThemeData(
        iconColor: muted,
        textColor: onSurface,
        shape: _rounded(12),
      ),

      cardTheme: CardThemeData(
        color: surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppColors.radius),
          side: BorderSide(color: hairline),
        ),
      ),

      // Buttons keep the web's 12px radius and flat filled look.
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.brand600,
          foregroundColor: Colors.white,
          textStyle:
              const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape: _rounded(AppColors.radiusSm),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.brand600,
          foregroundColor: Colors.white,
          elevation: 0,
          textStyle:
              const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape: _rounded(AppColors.radiusSm),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.brand600,
          side: const BorderSide(color: AppColors.brand600, width: 1.4),
          textStyle:
              const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
          shape: _rounded(AppColors.radiusSm),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.brand600,
          textStyle:
              const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600),
          shape: _rounded(10),
        ),
      ),

      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isDark ? AppColors.ink700 : AppColors.ink800,
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 14),
        actionTextColor: AppColors.brand300,
        shape: _rounded(12),
        elevation: 4,
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
        ),
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: surface,
        surfaceTintColor: Colors.transparent,
        shape: _rounded(20),
        titleTextStyle: TextStyle(
          color: onSurface,
          fontSize: 18,
          fontWeight: FontWeight.w700,
        ),
        contentTextStyle: TextStyle(color: muted, fontSize: 14.5),
      ),

      popupMenuTheme: PopupMenuThemeData(
        color: surface,
        surfaceTintColor: Colors.transparent,
        shape: _rounded(14),
        elevation: 6,
      ),

      chipTheme: ChipThemeData(
        backgroundColor: isDark ? AppColors.ink700 : AppColors.ink100,
        selectedColor: AppColors.brand600.withValues(alpha: 0.14),
        labelStyle: TextStyle(
          color: onSurface,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
        side: BorderSide(color: hairline),
        shape: _rounded(999),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      ),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) =>
              states.contains(WidgetState.selected) ? Colors.white : null,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected)
              ? AppColors.brand600
              : (isDark ? AppColors.ink700 : AppColors.ink200),
        ),
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: AppColors.brand600,
        linearTrackColor: isDark ? AppColors.ink700 : AppColors.ink100,
      ),

      iconTheme: IconThemeData(color: muted, size: 22),
      primaryIconTheme: const IconThemeData(color: Colors.white),

      textTheme: Typography.material2021(platform: TargetPlatform.android)
          .black
          .apply(bodyColor: onSurface, displayColor: onSurface)
          .copyWith(
            titleLarge: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              letterSpacing: -0.3,
              color: onSurface,
            ),
            titleMedium: TextStyle(
              fontSize: 15.5,
              fontWeight: FontWeight.w700,
              color: onSurface,
            ),
            bodyMedium: TextStyle(fontSize: 14.5, color: onSurface),
            bodySmall: TextStyle(fontSize: 12.5, color: muted),
          ),
    );
  }
}
