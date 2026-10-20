import 'package:flutter/foundation.dart';

import '../../../shared/models/user_model.dart';
import '../../../shared/services/api_client.dart';
import '../../auth/services/auth_service.dart';

/// "Who can see when I am online" settings.
///
/// Two levels, matching what the server enforces:
///  * a master switch — nobody sees your presence;
///  * a per-person exception list — everyone sees it except these people.
class PrivacyService extends ChangeNotifier {
  PrivacyService(this._auth, {ApiClient? apiClient}) : _api = apiClient ?? _auth.api;

  final AuthService _auth;
  final ApiClient _api;

  bool _showOnlineStatus = true;
  List<UserModel> _hiddenFrom = [];
  bool _isLoading = false;
  bool _isSaving = false;
  String? _errorMessage;

  bool get showOnlineStatus => _showOnlineStatus;
  List<UserModel> get hiddenFrom => List.unmodifiable(_hiddenFrom);
  bool get isLoading => _isLoading;
  bool get isSaving => _isSaving;
  String? get errorMessage => _errorMessage;

  Future<void> load() async {
    if (_auth.token == null) return;

    _isLoading = true;
    notifyListeners();

    final response = await _api.get('/api/users/me/privacy');
    _isLoading = false;

    if (response.ok && response.data is Map) {
      final data = Map<String, dynamic>.from(response.data as Map);
      _showOnlineStatus = data['showOnlineStatus'] != false;
      final hidden = data['hiddenFrom'];
      _hiddenFrom = hidden is List
          ? hidden
              .whereType<Map>()
              .map((json) => UserModel.fromJson(Map<String, dynamic>.from(json)))
              .toList()
          : [];
      _errorMessage = null;
    } else {
      _errorMessage = response.errorMessage;
    }
    notifyListeners();
  }

  Future<bool> _save() async {
    _isSaving = true;
    notifyListeners();

    final response = await _api.put('/api/users/me/privacy', body: {
      'showOnlineStatus': _showOnlineStatus,
      'hiddenFrom': _hiddenFrom.map((u) => u.id).toList(),
    });

    _isSaving = false;

    if (response.ok && response.data is Map) {
      final data = Map<String, dynamic>.from(response.data as Map);
      _showOnlineStatus = data['showOnlineStatus'] != false;
      _errorMessage = null;
      notifyListeners();
      return true;
    }

    _errorMessage = response.errorMessage;
    notifyListeners();
    return false;
  }

  Future<bool> setShowOnlineStatus(bool value) async {
    _showOnlineStatus = value;
    notifyListeners();
    return _save();
  }

  Future<bool> hideFrom(UserModel user) async {
    if (_hiddenFrom.any((u) => u.id == user.id)) return true;
    _hiddenFrom = [..._hiddenFrom, user];
    notifyListeners();
    return _save();
  }

  Future<bool> showTo(String userId) async {
    _hiddenFrom = _hiddenFrom.where((u) => u.id != userId).toList();
    notifyListeners();
    return _save();
  }

  bool isHiddenFrom(String userId) => _hiddenFrom.any((u) => u.id == userId);
}
