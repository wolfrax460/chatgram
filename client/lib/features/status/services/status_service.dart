import 'package:flutter/foundation.dart';

import '../../../shared/models/status_model.dart';
import '../../../shared/services/api_client.dart';
import '../../auth/services/auth_service.dart';

class StatusService extends ChangeNotifier {
  StatusService(this._auth, {ApiClient? apiClient}) : _api = apiClient ?? _auth.api;

  final AuthService _auth;
  final ApiClient _api;

  List<StatusModel> _statuses = [];
  bool _isLoading = false;
  String? _errorMessage;

  List<StatusModel> get statuses => List.unmodifiable(_statuses);
  bool get isLoading => _isLoading;
  String? get errorMessage => _errorMessage;

  List<StatusModel> get myStatuses =>
      _statuses.where((s) => s.isMine(_auth.currentUserId)).toList();

  /// Recent updates from everyone else, newest first.
  List<StatusModel> get contactStatuses {
    final list = _statuses.where((s) => !s.isMine(_auth.currentUserId)).toList();
    list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    return list;
  }

  /// Grouped by author for the "recent updates" list.
  Map<String, List<StatusModel>> get groupedByUser {
    final map = <String, List<StatusModel>>{};
    for (final status in contactStatuses) {
      map.putIfAbsent(status.userId, () => []).add(status);
    }
    return map;
  }

  // ------------------------------------------------------------- unseen state
  bool _isUnseen(StatusModel status) {
    final myId = _auth.currentUserId;
    if (myId == null) return false;
    return !status.viewedBy.contains(myId);
  }

  /// Updates from my contacts that I have not opened yet.
  List<StatusModel> get unseenStatuses => contactStatuses.where(_isUnseen).toList();

  int get unseenCount => unseenStatuses.length;

  /// Drives the little green dot on the Status tab: it shows while anything is
  /// unwatched and disappears once everything has been seen.
  bool get hasUnseen => unseenCount > 0;

  /// Authors with at least one unwatched update (dot next to their row).
  Set<String> get unseenAuthors => unseenStatuses.map((s) => s.userId).toSet();

  bool hasUnseenFrom(String userId) => unseenAuthors.contains(userId);

  /// The updates for [userId], oldest first — the order to play them in.
  List<StatusModel> statusesFor(String userId) {
    final list = _statuses.where((s) => s.userId == userId).toList();
    list.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return list;
  }

  /// Fetch and store a single status without reloading everything.
  Future<bool> loadStatusesQuietly() async {
    if (_auth.token == null) return false;
    final response = await _api.get('/api/status');
    if (response.ok && response.data is List) {
      _statuses = (response.data as List)
          .whereType<Map>()
          .map((json) => StatusModel.fromJson(Map<String, dynamic>.from(json)))
          .toList();
      notifyListeners();
      return true;
    }
    return false;
  }

  /// Marks every update from [userId] as seen locally (the server call for each
  /// is fired by the viewer as it plays).
  void markAuthorSeenLocally(String userId) {
    final myId = _auth.currentUserId;
    if (myId == null) return;

    var changed = false;
    _statuses = _statuses.map((status) {
      if (status.userId != userId) return status;
      if (status.viewedBy.contains(myId)) return status;
      changed = true;
      return StatusModel(
        id: status.id,
        userId: status.userId,
        user: status.user,
        text: status.text,
        mediaUrl: status.mediaUrl,
        createdAt: status.createdAt,
        viewedBy: [...status.viewedBy, myId],
      );
    }).toList();

    if (changed) notifyListeners();
  }

  Future<bool> loadStatuses() async {
    if (_auth.token == null) {
      _setError('You are not signed in.');
      return false;
    }

    _isLoading = true;
    notifyListeners();

    final response = await _api.get('/api/status');
    _isLoading = false;

    if (response.ok && response.data is List) {
      _statuses = (response.data as List)
          .whereType<Map>()
          .map((json) => StatusModel.fromJson(Map<String, dynamic>.from(json)))
          .toList();
      _errorMessage = null;
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  Future<bool> createStatus({String? text, String? mediaUrl}) async {
    final response = await _api.post('/api/status', body: {
      if (text != null && text.trim().isNotEmpty) 'text': text.trim(),
      if (mediaUrl != null && mediaUrl.isNotEmpty) 'mediaUrl': mediaUrl,
    });

    if (response.ok && response.data is Map) {
      _statuses.insert(0, StatusModel.fromJson(Map<String, dynamic>.from(response.data as Map)));
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  /// Uploads an image and posts it as a status.
  Future<bool> createMediaStatus({
    required List<int> bytes,
    required String filename,
    String? mimeType,
    String? caption,
  }) async {
    final upload = await _api.upload(
      '/api/messages/media',
      bytes: bytes,
      filename: filename,
      field: 'file',
      mimeType: mimeType,
      fields: {'type': 'status'},
    );

    if (!upload.ok || upload.data is! Map) {
      _setError(upload.errorMessage);
      return false;
    }

    final file = Map<String, dynamic>.from(upload.data as Map)['file'];
    final url = (file is Map ? file['url'] : null)?.toString();
    if (url == null) {
      _setError('Upload succeeded but no URL was returned.');
      return false;
    }

    return createStatus(text: caption, mediaUrl: url);
  }

  Future<bool> deleteStatus(String statusId) async {
    final response = await _api.delete('/api/status/$statusId');
    if (response.ok) {
      _statuses.removeWhere((s) => s.id == statusId);
      notifyListeners();
      return true;
    }
    _setError(response.errorMessage);
    return false;
  }

  Future<bool> viewStatus(String statusId) async {
    final response = await _api.post('/api/status/$statusId/view');
    if (response.ok) {
      final idx = _statuses.indexWhere((s) => s.id == statusId);
      final myId = _auth.currentUserId;
      if (idx != -1 && myId != null && !_statuses[idx].viewedBy.contains(myId)) {
        final updated = _statuses[idx];
        _statuses[idx] = StatusModel(
          id: updated.id,
          userId: updated.userId,
          user: updated.user,
          text: updated.text,
          mediaUrl: updated.mediaUrl,
          createdAt: updated.createdAt,
          viewedBy: [...updated.viewedBy, myId],
        );
        notifyListeners();
      }
      return true;
    }
    return false;
  }

  void _setError(String message) {
    _errorMessage = message;
    notifyListeners();
  }
}
