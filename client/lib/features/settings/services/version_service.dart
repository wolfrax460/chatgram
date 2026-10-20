import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../shared/services/api_client.dart';

/// The version of this build.
///
/// Override at build time so a release does not need a code change:
///   flutter build apk --release --dart-define=APP_VERSION=1.1.0
const String kAppVersion = String.fromEnvironment('APP_VERSION', defaultValue: '1.0.0');

/// Reports this install to the server and surfaces update notices.
///
/// The server decides what is current via APP_LATEST_VERSION / APP_MIN_VERSION,
/// so telling everyone about a new release is a config change plus a restart —
/// no need to touch the app just to change the notice.
class VersionService extends ChangeNotifier {
  VersionService(this._api);

  final ApiClient _api;

  static const _kDeviceId = 'app.deviceId';

  bool _updateAvailable = false;
  bool _updateRequired = false;
  bool _checking = false;
  bool _checked = false;
  String? _latestVersion;
  String? _updateUrl;
  String? _releaseNotes;
  String? _error;

  String get appVersion => kAppVersion;
  bool get updateAvailable => _updateAvailable;
  bool get updateRequired => _updateRequired;
  bool get isChecking => _checking;
  bool get hasChecked => _checked;
  String? get latestVersion => _latestVersion;
  String? get updateUrl => _updateUrl;
  String? get releaseNotes => _releaseNotes;
  String? get error => _error;

  /// True when there is something worth showing the user.
  bool get shouldNotify => _updateRequired || _updateAvailable;

  static String platformName() {
    if (kIsWeb) return 'web';
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      case TargetPlatform.windows:
        return 'windows';
      case TargetPlatform.macOS:
        return 'macos';
      case TargetPlatform.linux:
        return 'linux';
      default:
        return 'unknown';
    }
  }

  /// A stable id for this install, so the server counts devices not launches.
  Future<String> _deviceId() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final existing = prefs.getString(_kDeviceId);
      if (existing != null && existing.isNotEmpty) return existing;

      final random = Random.secure();
      final generated =
          '${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-'
          '${List.generate(8, (_) => random.nextInt(36).toRadixString(36)).join()}';
      await prefs.setString(_kDeviceId, generated);
      return generated;
    } catch (_) {
      // No storage available: fall back to a per-session id.
      return 'session-${DateTime.now().millisecondsSinceEpoch}';
    }
  }

  /// Tell the server which version is running and read back the policy.
  Future<void> check() async {
    if (_checking) return;
    _checking = true;
    notifyListeners();

    try {
      final response = await _api.post('/api/app/heartbeat', body: {
        'version': kAppVersion,
        'platform': platformName(),
        'deviceId': await _deviceId(),
      });

      if (response.ok && response.data is Map) {
        final data = Map<String, dynamic>.from(response.data as Map);
        _updateRequired = data['updateRequired'] == true;
        _updateAvailable = data['updateAvailable'] == true;
        _latestVersion = data['latestVersion']?.toString();
        _updateUrl = data['updateUrl']?.toString();
        _releaseNotes = data['releaseNotes']?.toString();
        _error = null;
        _checked = true;
      } else {
        _error = response.errorMessage;
      }
    } catch (e) {
      _error = '$e';
    } finally {
      _checking = false;
      notifyListeners();
    }
  }

  /// Dismiss the non-blocking "update available" banner for this session.
  void dismissBanner() {
    _updateAvailable = false;
    notifyListeners();
  }
}
