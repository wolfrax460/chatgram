import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../server_config.dart';

/// Result of an API call: a status code plus decoded JSON (or raw text).
class ApiResponse {
  ApiResponse(this.statusCode, this.data);

  final int statusCode;
  final dynamic data;

  bool get ok => statusCode >= 200 && statusCode < 300;
  bool get isUnauthorized => statusCode == 401;
  bool get isOffline => statusCode == 0;

  /// Human-readable message from the server, falling back to the raw body.
  String get errorMessage {
    final body = data;
    if (body is Map && body['message'] != null) return body['message'].toString();
    if (body is String && body.isNotEmpty) return body;
    if (isOffline) return 'Cannot reach the server. Is the backend running?';
    return 'Request failed with status $statusCode';
  }

  /// Server error code such as `TOKEN_EXPIRED` or `DB_UNAVAILABLE`.
  String? get errorCode {
    final body = data;
    if (body is Map && body['code'] != null) return body['code'].toString();
    return null;
  }
}

/// Single HTTP entry point for the whole app.
///
/// Fixes the "frontend and backend are not communicating" class of problems by
/// centralising:
///  * the base URL and JSON headers,
///  * the `Authorization: Bearer` header,
///  * transparent access-token refresh + retry on 401,
///  * connection-error handling that surfaces a readable message instead of an
///    opaque exception string.
class ApiClient {
  ApiClient();

  String? _accessToken;
  String? _refreshToken;

  /// Set by [AuthService]; performs the refresh round-trip.
  Future<bool> Function()? onRefreshToken;

  /// Set by [AuthService]; called when refresh fails and the session is dead.
  Future<void> Function()? onSessionExpired;

  String? get accessToken => _accessToken;
  String? get refreshToken => _refreshToken;

  void setTokens({String? accessToken, String? refreshToken}) {
    _accessToken = accessToken;
    if (refreshToken != null) _refreshToken = refreshToken;
  }

  void clearTokens() {
    _accessToken = null;
    _refreshToken = null;
  }

  /// Per-attempt timeout.
  ///
  /// This used to be 20s *with two retries*, so an unreachable server made a
  /// single request hang for up to 60 seconds — and startup fires several at
  /// once. That is what made the phone app feel frozen. A local/LAN server
  /// answers in milliseconds, so 8s is already generous.
  static const Duration _timeout = Duration(seconds: 8);

  /// How many extra attempts a *connection* failure gets.
  ///
  /// A refused connection fails immediately, so retrying is cheap and covers a
  /// backend restart, a laptop waking up or the Wi-Fi reconnecting.
  static const int _networkRetries = 2;
  static const Duration _retryDelay = Duration(milliseconds: 400);

  /// True when the last request failed to reach the server at all.
  ///
  /// The UI watches this to show "cannot reach the server" instead of spinning.
  bool _serverUnreachable = false;
  bool get serverUnreachable => _serverUnreachable;

  /// Called whenever reachability flips, so the UI can react immediately.
  void Function(bool reachable)? onReachabilityChanged;

  void _setReachable(bool reachable) {
    final unreachable = !reachable;
    if (_serverUnreachable == unreachable) return;
    _serverUnreachable = unreachable;
    onReachabilityChanged?.call(reachable);
  }

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final base = Uri.parse('$apiBaseUrl$path');
    if (query == null || query.isEmpty) return base;
    final params = <String, String>{};
    query.forEach((key, value) {
      if (value != null) params[key] = value.toString();
    });
    return base.replace(queryParameters: {...base.queryParameters, ...params});
  }

  Map<String, String> _headers({bool json = true}) {
    final headers = <String, String>{};
    if (json) headers['Content-Type'] = 'application/json';
    headers['Accept'] = 'application/json';
    if (_accessToken != null) headers['Authorization'] = 'Bearer $_accessToken';
    return headers;
  }

  Future<ApiResponse> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => http.get(_uri(path, query), headers: _headers()));

  Future<ApiResponse> post(String path, {Object? body, Map<String, dynamic>? query}) =>
      _send(() => http.post(
            _uri(path, query),
            headers: _headers(),
            body: body == null ? null : jsonEncode(body),
          ));

  Future<ApiResponse> put(String path, {Object? body}) =>
      _send(() => http.put(_uri(path), headers: _headers(), body: jsonEncode(body ?? {})));

  Future<ApiResponse> patch(String path, {Object? body}) =>
      _send(() => http.patch(_uri(path), headers: _headers(), body: jsonEncode(body ?? {})));

  Future<ApiResponse> delete(String path, {Object? body}) =>
      _send(() => http.delete(
            _uri(path),
            headers: _headers(),
            body: body == null ? null : jsonEncode(body),
          ));

  /// Multipart upload built from bytes so it works on web *and* native.
  Future<ApiResponse> upload(
    String path, {
    required List<int> bytes,
    required String filename,
    String field = 'file',
    String? mimeType,
    Map<String, String> fields = const {},
  }) async {
    Future<ApiResponse> attempt() async {
      try {
        final request = http.MultipartRequest('POST', _uri(path));
        request.headers.addAll(_headers(json: false));
        request.fields.addAll(fields);
        request.files.add(http.MultipartFile.fromBytes(
          field,
          bytes,
          filename: filename,
          contentType: mimeType == null ? null : _parseMediaType(mimeType),
        ));
        final streamed = await request.send().timeout(const Duration(seconds: 60));
        final response = await http.Response.fromStream(streamed);
        return _decode(response);
      } on TimeoutException {
        return ApiResponse(0, {'message': 'Upload timed out.'});
      } catch (e) {
        return ApiResponse(0, {'message': 'Upload failed: $e'});
      }
    }

    final first = await attempt();
    if (first.isUnauthorized && await _tryRefresh()) return attempt();
    return first;
  }

  Future<ApiResponse> _send(Future<http.Response> Function() request) async {
    final first = await _run(request);

    // One transparent refresh + retry when the access token has expired.
    if (first.isUnauthorized && await _tryRefresh()) {
      return _run(request);
    }

    if (first.isUnauthorized && first.errorCode != 'TOKEN_EXPIRED') {
      // Genuinely invalid credentials/session.
      await onSessionExpired?.call();
    }
    return first;
  }

  Future<ApiResponse> _run(Future<http.Response> Function() request) async {
    ApiResponse? last;

    for (var attempt = 0; attempt <= _networkRetries; attempt++) {
      try {
        final response = await request().timeout(_timeout);
        _setReachable(true);
        return _decode(response);
      } on TimeoutException {
        // The host is not answering. Retrying would only multiply the wait, so
        // fail fast and let the UI say so.
        _setReachable(false);
        return ApiResponse(0, {
          'message':
              'The server at $apiBaseUrl is not responding. Check that the backend is running.',
          'code': 'TIMEOUT',
        });
      } catch (e) {
        debugPrint('ApiClient network error (attempt ${attempt + 1}): $e');
        last = ApiResponse(0, {
          'message': 'Cannot reach the server at $apiBaseUrl. Is the backend running?',
          'code': 'NETWORK_ERROR',
        });
      }

      // Only connection-level failures are retried; real HTTP responses and
      // timeouts are returned above.
      if (attempt < _networkRetries) {
        await Future<void>.delayed(_retryDelay * (attempt + 1));
        onRetry?.call();
      }
    }

    _setReachable(false);
    return last!;
  }

  /// Notified when a request is about to be retried (used to surface
  /// "reconnecting…" in the UI).
  void Function()? onRetry;

  ApiResponse _decode(http.Response response) {
    dynamic data;
    final body = response.body;
    if (body.isNotEmpty) {
      try {
        data = jsonDecode(body);
      } catch (_) {
        data = body;
      }
    }
    return ApiResponse(response.statusCode, data);
  }

  bool _refreshing = false;

  Future<bool> _tryRefresh() async {
    if (onRefreshToken == null || _refreshToken == null) return false;
    if (_refreshing) return false;
    _refreshing = true;
    try {
      return await onRefreshToken!.call();
    } finally {
      _refreshing = false;
    }
  }

  /// Minimal `MediaType` for multipart uploads without pulling in a new dep.
  static _parseMediaType(String mime) {
    final parts = mime.split('/');
    if (parts.length != 2) return null;
    return http.MediaType(parts[0], parts[1]);
  }
}
