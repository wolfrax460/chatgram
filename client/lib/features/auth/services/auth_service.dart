import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../server_config.dart';
import '../../../shared/models/user_model.dart';
import '../../../shared/services/api_client.dart';

class AuthService extends ChangeNotifier {
  AuthService({ApiClient? apiClient}) : api = apiClient ?? ApiClient() {
    // Let the API client refresh a dead access token transparently, and end
    // the session when the refresh token is no longer valid.
    api.onRefreshToken = refreshAuthToken;
    api.onSessionExpired = () async => _clearSession(notify: true);
    // Surface connectivity changes so the app can explain a dead server
    // instead of appearing to hang.
    api.onReachabilityChanged = (reachable) {
      if (_serverUnreachable == !reachable) return;
      _serverUnreachable = !reachable;
      notifyListeners();
    };
  }

  final ApiClient api;

  bool _serverUnreachable = false;

  /// True when the backend could not be reached on the last attempt.
  bool get serverUnreachable => _serverUnreachable;

  /// Ping the server and update [serverUnreachable]. Used after the user edits
  /// the server address so the banner clears without a restart.
  Future<bool> retryReachability() async {
    final response = await api.get('/api/health');
    // 503 means "up but the database is down" — still reachable.
    final reachable = response.ok || response.statusCode == 503;
    _serverUnreachable = !reachable;
    notifyListeners();
    return reachable;
  }

  UserModel? _currentUser;
  String? _token;
  String? _refreshToken;
  String? _verificationToken;
  bool _isLoading = false;
  String? _errorMessage;

  UserModel? get currentUser => _currentUser;
  String? get token => _token;
  String? get refreshToken => _refreshToken;

  /// Short-lived proof that the email/phone was verified; sent with register.
  String? get verificationToken => _verificationToken;
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;
  bool get isAuthenticated => _currentUser != null && _token != null;
  String? get currentUserId => _currentUser?.id;

  static const _kToken = 'token';
  static const _kRefreshToken = 'refreshToken';
  static const _kUser = 'user';

  // ------------------------------------------------------------------ login
  Future<bool> login(String identifier, String password) async {
    _setLoading(true);
    _clearError();

    final response = await api.post('/api/auth/login', body: {
      'identifier': identifier.trim(),
      'password': password,
    });

    if (response.ok && response.data is Map) {
      await _persistSession(Map<String, dynamic>.from(response.data as Map));
      _setLoading(false);
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    _setLoading(false);
    return false;
  }

  // ----------------------------------------------------------- verification
  /// Ask the server to email/text a 6-digit code to [target].
  ///
  /// Returns the server payload on success. In development, when no mail or SMS
  /// provider is configured, it contains `devCode` so the flow can be used.
  Future<Map<String, dynamic>?> sendVerificationCode(String target) async {
    _clearError();
    final response = await api.post('/api/auth/verification/send', body: {
      'target': target.trim(),
    });

    if (response.ok && response.data is Map) {
      return Map<String, dynamic>.from(response.data as Map);
    }
    _setError(response.errorMessage);
    notifyListeners();
    return null;
  }

  /// Confirm a code. On success the returned proof token is remembered and
  /// attached to the next [register] call.
  Future<bool> verifyCode(String target, String code) async {
    _clearError();
    final response = await api.post('/api/auth/verification/check', body: {
      'target': target.trim(),
      'code': code.trim(),
    });

    if (response.ok && response.data is Map) {
      _verificationToken =
          Map<String, dynamic>.from(response.data as Map)['verificationToken']?.toString();
      notifyListeners();
      return true;
    }
    _setError(response.errorMessage);
    notifyListeners();
    return false;
  }

  /// Is this email/phone free to register?
  Future<bool?> isIdentifierAvailable(String target) async {
    final response = await api.post('/api/auth/check-identifier', body: {
      'target': target.trim(),
    });
    if (response.ok && response.data is Map) {
      return Map<String, dynamic>.from(response.data as Map)['available'] == true;
    }
    return null;
  }

  // ------------------------------------------------------------ server config
  bool _verificationRequired = false;
  bool _googleEnabled = false;
  String? _googleRedirectUri;

  /// True when the server refuses registrations that were not verified.
  /// The sign-up screen uses this to require verification up front instead of
  /// letting the user hit a 403.
  bool get verificationRequired => _verificationRequired;

  /// True when the server has Google OAuth credentials configured.
  bool get googleEnabled => _googleEnabled;

  /// True only when Google sign-in can actually COMPLETE on this device.
  ///
  /// Google redirects the browser to `google.redirectUri`. That address has to
  /// be resolvable *from the device doing the signing in*. When the server is
  /// reached over a LAN IP but the redirect points at `localhost`, the browser
  /// goes looking for the server on the device itself — on a phone that is the
  /// phone, nothing is listening, and the sign-in dead-ends. So we only offer
  /// the button when the two hosts agree.
  bool get googleUsable {
    if (!_googleEnabled) return false;

    final redirect = Uri.tryParse(_googleRedirectUri ?? '');
    final base = Uri.tryParse(apiBaseUrl);
    if (redirect == null || base == null) return false;
    if (redirect.host.isEmpty || base.host.isEmpty) return false;

    return redirect.host == base.host && redirect.port == base.port;
  }

  /// Why Google sign-in is unavailable, for the UI to explain.
  String? get googleUnavailableReason {
    if (!_googleEnabled) return null;
    if (googleUsable) return null;
    return 'Google sign-in only works when the app can reach the server on '
        'the same address Google redirects to (localhost). On a phone or '
        'another computer you need the server on HTTPS — sign in with email '
        'and password instead.';
  }

  /// Reads public server settings. Safe to call on startup.
  Future<void> loadServerConfig() async {
    try {
      final response = await api.get('/api/config');
      if (response.ok && response.data is Map) {
        final data = Map<String, dynamic>.from(response.data as Map);
        final required = data['verificationRequired'] == true;
        final google = data['google'];
        final googleOn = google is Map && google['enabled'] == true;
        final redirect = google is Map ? google['redirectUri']?.toString() : null;

        if (required != _verificationRequired ||
            googleOn != _googleEnabled ||
            redirect != _googleRedirectUri) {
          _verificationRequired = required;
          _googleEnabled = googleOn;
          _googleRedirectUri = redirect;
          notifyListeners();
        }
      }
    } catch (e) {
      debugPrint('Could not load server config: $e');
    }
  }

  // ---------------------------------------------------------- google sign-in
  bool _googleSignInInProgress = false;
  bool get googleSignInInProgress => _googleSignInInProgress;

  /// Sign in (or sign up) with Google.
  ///
  /// Opens Google's consent screen in the system browser and polls the server
  /// until it reports the result. The same code works on web, Android and
  /// Windows — nothing platform-specific is required.
  Future<bool> signInWithGoogle() async {
    if (_googleSignInInProgress) return false;

    _clearError();
    _googleSignInInProgress = true;
    notifyListeners();

    try {
      final start = await api.get('/api/auth/google/url');

      if (!start.ok || start.data is! Map) {
        _setError(
          start.errorCode == 'GOOGLE_NOT_CONFIGURED'
              ? 'Google sign-in is not configured on this server yet.'
              : start.errorMessage,
        );
        return false;
      }

      final data = Map<String, dynamic>.from(start.data as Map);
      final url = data['url']?.toString();
      final state = data['state']?.toString();

      if (url == null || state == null) {
        _setError('The server did not return a Google sign-in URL.');
        return false;
      }

      final uri = Uri.tryParse(url);
      if (uri == null) {
        _setError('The Google sign-in URL was malformed.');
        return false;
      }

      final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!launched) {
        _setError('Could not open the browser for Google sign-in.');
        return false;
      }

      // Poll until the browser half of the flow completes.
      final deadline = DateTime.now().add(const Duration(minutes: 3));
      while (DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(seconds: 2));

        final res = await api.get('/api/auth/google/poll', query: {'state': state});
        if (!res.ok || res.data is! Map) continue;

        final poll = Map<String, dynamic>.from(res.data as Map);
        final status = poll['status']?.toString();

        if (status == 'ready') {
          await _persistSession(poll);
          debugPrint('Google sign-in complete (created=${poll['created']})');
          return true;
        }

        if (status == 'error') {
          _setError(poll['message']?.toString() ?? 'Google sign-in failed.');
          return false;
        }

        if (status == 'unknown') {
          _setError('This sign-in link expired. Please try again.');
          return false;
        }
        // 'pending' -> keep waiting.
      }

      _setError('Timed out waiting for Google sign-in. Please try again.');
      return false;
    } catch (e) {
      _setError('Google sign-in error: $e');
      return false;
    } finally {
      _googleSignInInProgress = false;
      notifyListeners();
    }
  }

  // -------------------------------------------------------- password reset
  /// Ask for a reset code. The server always answers the same way so this
  /// cannot be used to discover which addresses have accounts.
  Future<Map<String, dynamic>?> requestPasswordReset(String target) async {
    _clearError();
    final response = await api.post('/api/auth/forgot-password', body: {
      'target': target.trim(),
    });

    if (response.ok && response.data is Map) {
      return Map<String, dynamic>.from(response.data as Map);
    }
    _setError(response.errorMessage);
    notifyListeners();
    return null;
  }

  /// Complete the reset with the code and a new password.
  Future<bool> resetPassword({
    required String target,
    required String code,
    required String newPassword,
  }) async {
    _clearError();
    final response = await api.post('/api/auth/reset-password', body: {
      'target': target.trim(),
      'code': code.trim(),
      'newPassword': newPassword,
    });

    if (response.ok) {
      notifyListeners();
      return true;
    }
    _setError(response.errorMessage);
    notifyListeners();
    return false;
  }

  // --------------------------------------------------------------- register
  Future<bool> register({
    required String displayName,
    required String identifier,
    required String password,
  }) async {
    _setLoading(true);
    _clearError();

    final response = await api.post('/api/auth/register', body: {
      'displayName': displayName.trim(),
      'identifier': identifier.trim(),
      'password': password,
      if (_verificationToken != null) 'verificationToken': _verificationToken,
    });

    if (response.ok && response.data is Map) {
      await _persistSession(Map<String, dynamic>.from(response.data as Map));
      _verificationToken = null;
      _setLoading(false);
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    _setLoading(false);
    return false;
  }

  // ----------------------------------------------------------------- logout
  Future<void> logout() async {
    _setLoading(true);
    try {
      if (_token != null) {
        // Best-effort: mark the user offline server-side.
        await api.post('/api/auth/logout');
      }
    } catch (_) {
      // Ignore network errors during logout.
    }
    await _clearSession(notify: true);
    _setLoading(false);
  }

  // -------------------------------------------------------- session restore
  Future<bool> loadUserFromStorage() async {
    _setLoading(true);
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString(_kToken);
      final refreshToken = prefs.getString(_kRefreshToken);
      final userJson = prefs.getString(_kUser);

      if (token == null || userJson == null) {
        _setLoading(false);
        return false;
      }

      _token = token;
      _refreshToken = refreshToken;
      _currentUser = UserModel.fromJson(
        Map<String, dynamic>.from(jsonDecode(userJson) as Map),
      );
      api.setTokens(accessToken: _token, refreshToken: _refreshToken);
      notifyListeners();

      // Confirm the stored session is still valid; refresh it if the access
      // token has expired (previously the app kept a dead token and every
      // request 401'd until the user logged in again).
      final probe = await api.get('/api/auth/me');
      if (probe.ok && probe.data is Map) {
        _currentUser = UserModel.fromJson(Map<String, dynamic>.from(probe.data as Map));
        await _saveUser(_currentUser!);
        notifyListeners();
      } else if (probe.isUnauthorized && !await refreshAuthToken()) {
        await _clearSession(notify: true);
        _setLoading(false);
        return false;
      }

      return true;
    } catch (e) {
      debugPrint('Error restoring session: $e');
      return false;
    } finally {
      _setLoading(false);
    }
  }

  // ------------------------------------------------------------ token refresh
  Future<bool> refreshAuthToken() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final stored = _refreshToken ?? prefs.getString(_kRefreshToken);
      if (stored == null) return false;

      // Raw call (not through ApiClient) to avoid recursive refresh attempts.
      final response = await api.post('/api/auth/refresh', body: {'token': stored});

      if (response.ok && response.data is Map) {
        final data = Map<String, dynamic>.from(response.data as Map);
        _token = data['accessToken']?.toString();
        // The server rotates the refresh token; keep the new one.
        _refreshToken = data['refreshToken']?.toString() ?? stored;
        api.setTokens(accessToken: _token, refreshToken: _refreshToken);

        if (_token != null) await prefs.setString(_kToken, _token!);
        await prefs.setString(_kRefreshToken, _refreshToken!);
        notifyListeners();
        return _token != null;
      }

      // Refresh token rejected -> the session is genuinely over.
      await _clearSession(notify: true);
      return false;
    } catch (e) {
      debugPrint('Token refresh error: $e');
      return false;
    }
  }

  // ---------------------------------------------------------------- profile
  Future<bool> updateProfile({String? displayName, String? about}) async {
    final id = _currentUser?.id;
    if (id == null) return false;

    _clearError();
    final response = await api.put('/api/users/$id', body: {
      if (displayName != null) 'displayName': displayName,
      if (about != null) 'about': about,
    });

    if (response.ok && response.data is Map) {
      _currentUser = UserModel.fromJson(Map<String, dynamic>.from(response.data as Map));
      await _saveUser(_currentUser!);
      notifyListeners();
      return true;
    }
    _setError(response.errorMessage);
    return false;
  }

  Future<bool> uploadAvatar({
    required List<int> bytes,
    required String filename,
    String? mimeType,
  }) async {
    final id = _currentUser?.id;
    if (id == null) return false;

    _clearError();
    final response = await api.upload(
      '/api/users/$id/avatar',
      bytes: bytes,
      filename: filename,
      field: 'avatar',
      mimeType: mimeType,
      fields: {'type': 'avatar'},
    );

    if (response.ok && response.data is Map) {
      final data = Map<String, dynamic>.from(response.data as Map);
      final userJson = data['user'];
      if (userJson is Map) {
        _currentUser = UserModel.fromJson(Map<String, dynamic>.from(userJson));
        await _saveUser(_currentUser!);
        notifyListeners();
        return true;
      }
    }
    _setError(response.errorMessage);
    return false;
  }

  // ---------------------------------------------------------------- helpers
  Future<void> _persistSession(Map<String, dynamic> data) async {
    _token = data['accessToken']?.toString();
    _refreshToken = data['refreshToken']?.toString();
    final userJson = data['user'];
    if (userJson is Map) {
      _currentUser = UserModel.fromJson(Map<String, dynamic>.from(userJson));
    }
    api.setTokens(accessToken: _token, refreshToken: _refreshToken);

    final prefs = await SharedPreferences.getInstance();
    if (_token != null) await prefs.setString(_kToken, _token!);
    if (_refreshToken != null) await prefs.setString(_kRefreshToken, _refreshToken!);
    if (_currentUser != null) await _saveUser(_currentUser!);
  }

  Future<void> _saveUser(UserModel user) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kUser, jsonEncode(user.toJson()));
  }

  Future<void> _clearSession({required bool notify}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kToken);
    await prefs.remove(_kRefreshToken);
    await prefs.remove(_kUser);

    _currentUser = null;
    _token = null;
    _refreshToken = null;
    api.clearTokens();

    if (notify) notifyListeners();
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  void _setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  void _setError(String message) {
    _errorMessage = message;
    notifyListeners();
  }

  void _clearError() {
    _errorMessage = null;
  }
}
