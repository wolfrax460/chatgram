import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Server configuration.
///
/// Picks the right backend URL per platform automatically:
///
///  * **Web** — discovers the API at runtime. If the page was served by the
///    Express backend itself (the normal setup) it uses that same origin. If it
///    was served by some other static server (`python -m http.server`, VS Code
///    Live Server, …) it falls back to port 5001 on the same host, so the app
///    still works instead of every request returning 501/404.
///  * **Android emulator** — `10.0.2.2`.
///  * **Desktop** — `localhost`.
///
/// Override any of it (physical device, split hosting, a tunnel, a deployed
/// API) with:
///
///   flutter build web --dart-define=API_BASE_URL=https://api.example.com
///
/// `SOCKET_URL` defaults to `API_BASE_URL` and only needs to be set when the
/// realtime endpoint lives somewhere else.
class ServerConfig {
  // Production names.
  static const String _apiDefine = String.fromEnvironment('API_URL');
  static const String _wsDefine = String.fromEnvironment('WS_URL');

  // Older names, kept so existing build scripts and IDE run configurations keep
  // working. The new names win when both are supplied.
  static const String _apiDefineLegacy = String.fromEnvironment('API_BASE_URL');
  static const String _wsDefineLegacy = String.fromEnvironment('SOCKET_URL');

  /// API base supplied at build time, e.g.
  ///   --dart-define=API_URL=https://chatgram.duckdns.org
  static const String _envApi =
      _apiDefine != '' ? _apiDefine : _apiDefineLegacy;

  /// Socket base supplied at build time, e.g.
  ///   --dart-define=WS_URL=wss://chatgram.duckdns.org
  static const String _envSocket =
      _wsDefine != '' ? _wsDefine : _wsDefineLegacy;

  static const int defaultPort = 5001;

  /// Runtime-discovered base URL (web only).
  static String? _resolved;

  /// Manually configured server, saved on the device.
  ///
  /// This is what lets a phone install point at the PC running the backend:
  /// a physical device has no way to guess the host's address the way the
  /// Android emulator does with 10.0.2.2.
  static String? _override;
  static const String _kServerPref = 'settings.serverUrl';

  static String? get override => _override;

  /// Load a previously saved server address. Call before [initialize].
  static Future<void> loadSavedServer() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(_kServerPref);
      if (saved != null && saved.trim().isNotEmpty) {
        _override = _stripTrailingSlash(saved.trim());
      }
    } catch (_) {
      // No saved value; fall back to auto-detection.
    }
  }

  /// Save (or clear) a manual server address.
  ///
  /// Returns false when [url] is not usable, so the UI can complain instead of
  /// silently accepting a typo.
  static Future<bool> saveServer(String? url) async {
    final value = (url ?? '').trim();

    if (value.isEmpty) {
      _override = null;
      await _persist(null);
      return true;
    }

    final normalized = _normalizeUrl(value);
    if (normalized == null) return false;
    if (!await _isBackend(normalized)) return false;

    _override = normalized;
    await _persist(normalized);
    return true;
  }

  /// Accepts `192.168.1.5`, `192.168.1.5:5001` or a full URL, and returns a
  /// clean `http://host:port` (defaulting to port 5001).
  static String? _normalizeUrl(String input) {
    var value = input.trim();
    if (!value.startsWith('http://') && !value.startsWith('https://')) {
      value = 'http://$value';
    }
    final uri = Uri.tryParse(value);
    if (uri == null || uri.host.isEmpty) return null;
    final port = uri.hasPort ? uri.port : defaultPort;
    return '${uri.scheme}://${uri.host}:$port';
  }

  static Future<void> _persist(String? value) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (value == null) {
        await prefs.remove(_kServerPref);
      } else {
        await prefs.setString(_kServerPref, value);
      }
    } catch (_) {
      // Best effort.
    }
  }

  /// Check whether a candidate URL answers like the Chatgram API.
  static Future<bool> isReachable(String input) async {
    final normalized = _normalizeUrl(input);
    if (normalized == null) return false;
    return _isBackend(normalized);
  }

  /// Resolve the backend before the first request.
  ///
  /// Called from `main()` so every widget sees a working [apiBaseUrl] from the
  /// very first frame.
  static Future<void> initialize() async {
    // An explicit --dart-define always wins.
    if (_envApi.isNotEmpty) {
      _resolved = _stripTrailingSlash(_envApi);
      return;
    }

    if (!kIsWeb) return;

    final origin = Uri.base.origin;
    if (origin.isEmpty || origin == 'null') return;

    // 1. The origin that served the page — the Express server hosts the app AND
    //    the API, so this is the normal, zero-config case.
    if (await _isBackend(origin)) {
      _resolved = _stripTrailingSlash(origin);
      return;
    }

    // 2. The page came from a plain static server. The API is almost certainly
    //    the same machine on the default port.
    final candidate = '${Uri.base.scheme}://${Uri.base.host}:$defaultPort';
    if (await _isBackend(candidate)) {
      _resolved = candidate;
      debugPrint('ServerConfig: app served from a static server; using $candidate');
      return;
    }

    // 3. Nothing answered. Keep the page origin so error messages make sense.
    _resolved = _stripTrailingSlash(origin);
    debugPrint('ServerConfig: no backend found at $origin or $candidate');
  }

  static Future<bool> _isBackend(String base) async {
    try {
      final res = await http
          .get(Uri.parse('$base/api/health'))
          .timeout(const Duration(seconds: 4));
      // 503 means "API is up but the database is down" — still the right host.
      return res.statusCode == 200 || res.statusCode == 503;
    } catch (_) {
      return false;
    }
  }

  /// REST base URL, without a trailing slash.
  static String get apiBaseUrl {
    // A server chosen by the user always wins.
    if (_override != null) return _override!;
    if (_resolved != null) return _resolved!;
    if (_envApi.isNotEmpty) return _stripTrailingSlash(_envApi);

    if (kIsWeb) {
      final origin = Uri.base.origin;
      if (origin.isNotEmpty && origin != 'null') return _stripTrailingSlash(origin);
      return 'http://localhost:$defaultPort';
    }

    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        // 10.0.2.2 is the host machine as seen from the Android emulator.
        // A physical device needs --dart-define=API_BASE_URL=http://<lan-ip>:5001
        return 'http://10.0.2.2:$defaultPort';
      default:
        return 'http://localhost:$defaultPort';
    }
  }

  /// Socket.IO base URL.
  static String get socketBaseUrl {
    if (_envSocket.isNotEmpty) return _stripTrailingSlash(_envSocket);
    return apiBaseUrl;
  }

  /// Turn a server-relative media path (`/uploads/media/x.jpg`) into an
  /// absolute URL. Avatars and status media are stored relative, so passing
  /// them straight to [NetworkImage] previously produced broken images.
  static String resolveMedia(String? path) {
    if (path == null) return '';
    final value = path.trim();
    if (value.isEmpty) return '';
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('data:')) return value;
    final normalised = value.startsWith('/') ? value : '/$value';
    return '$apiBaseUrl$normalised';
  }

  static String _stripTrailingSlash(String value) =>
      value.endsWith('/') ? value.substring(0, value.length - 1) : value;

  @visibleForTesting
  static void resetForTesting() => _resolved = null;
}

// Backwards-compatible top-level accessors used across the app.
String get apiBaseUrl => ServerConfig.apiBaseUrl;
String get socketBaseUrl => ServerConfig.socketBaseUrl;
String resolveMediaUrl(String? path) => ServerConfig.resolveMedia(path);
