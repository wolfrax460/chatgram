import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// App preferences, persisted locally.
///
/// The previous version simulated every write with a `Future.delayed` and the
/// settings screen never called it, so nothing was ever saved.
class SettingsService with ChangeNotifier {
  static const _kNotifications = 'settings.notificationsEnabled';
  static const _kSounds = 'settings.soundsEnabled';
  static const _kReadReceipts = 'settings.readReceiptsEnabled';
  static const _kDarkMode = 'settings.themeMode';
  static const _kWelcomeSeen = 'settings.welcomeSeen';

  bool _notificationsEnabled = true;
  bool _soundsEnabled = true;
  bool _readReceiptsEnabled = true;
  bool _hasSeenWelcome = false;
  ThemeMode _themeMode = ThemeMode.system;
  bool _isLoading = false;
  bool _loaded = false;

  bool get notificationsEnabled => _notificationsEnabled;
  bool get soundsEnabled => _soundsEnabled;
  bool get readReceiptsEnabled => _readReceiptsEnabled;

  /// Whether the WhatsApp-style welcome/landing screen has been dismissed.
  bool get hasSeenWelcome => _hasSeenWelcome;
  ThemeMode get themeMode => _themeMode;
  bool get isLoading => _isLoading;
  bool get loaded => _loaded;

  Future<void> loadSettings() async {
    _isLoading = true;
    notifyListeners();

    try {
      final prefs = await SharedPreferences.getInstance();
      _notificationsEnabled = prefs.getBool(_kNotifications) ?? true;
      _soundsEnabled = prefs.getBool(_kSounds) ?? true;
      _readReceiptsEnabled = prefs.getBool(_kReadReceipts) ?? true;
      _hasSeenWelcome = prefs.getBool(_kWelcomeSeen) ?? false;
      _themeMode = _themeModeFromString(prefs.getString(_kDarkMode));
      _loaded = true;
    } catch (_) {
      // Fall back to defaults.
      _loaded = true;
    }

    _isLoading = false;
    notifyListeners();
  }

  Future<void> markWelcomeSeen() async {
    if (_hasSeenWelcome) return;
    _hasSeenWelcome = true;
    notifyListeners();
    await _write((p) => p.setBool(_kWelcomeSeen, true));
  }

  Future<void> setNotifications(bool value) async {
    _notificationsEnabled = value;
    notifyListeners();
    await _write((p) => p.setBool(_kNotifications, value));
  }

  Future<void> setSounds(bool value) async {
    _soundsEnabled = value;
    notifyListeners();
    await _write((p) => p.setBool(_kSounds, value));
  }

  Future<void> setReadReceipts(bool value) async {
    _readReceiptsEnabled = value;
    notifyListeners();
    await _write((p) => p.setBool(_kReadReceipts, value));
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    _themeMode = mode;
    notifyListeners();
    await _write((p) => p.setString(_kDarkMode, mode.name));
  }

  Future<void> cycleThemeMode() async {
    switch (_themeMode) {
      case ThemeMode.system:
        await setThemeMode(ThemeMode.light);
      case ThemeMode.light:
        await setThemeMode(ThemeMode.dark);
      case ThemeMode.dark:
        await setThemeMode(ThemeMode.system);
    }
  }

  Future<void> _write(Future<void> Function(SharedPreferences) action) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await action(prefs);
    } catch (_) {
      // Preferences are best-effort; the in-memory value already updated.
    }
  }

  static ThemeMode _themeModeFromString(String? value) {
    switch (value) {
      case 'light':
        return ThemeMode.light;
      case 'dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }
}
