import 'package:flutter/foundation.dart';

import '../../../shared/models/user_model.dart';
import '../../../shared/services/api_client.dart';
import '../../auth/services/auth_service.dart';

/// A search result from the directory: a user plus whether they are already in
/// my address book.
class DirectoryResult {
  const DirectoryResult({required this.user, required this.isContact});

  final UserModel user;
  final bool isContact;

  factory DirectoryResult.fromJson(Map<String, dynamic> json) => DirectoryResult(
        user: UserModel.fromJson(json),
        isContact: json['isContact'] == true,
      );
}

/// The signed-in user's own address book.
///
/// Previously this screen listed *every* account in the application. It now
/// shows only people you added, and you add them by searching the directory.
class ContactsService extends ChangeNotifier {
  ContactsService(this._auth, {ApiClient? apiClient}) : _api = apiClient ?? _auth.api;

  final AuthService _auth;
  final ApiClient _api;

  List<UserModel> _contacts = [];
  List<UserModel> _suggestions = [];
  bool _isLoading = false;
  bool _isSearching = false;
  bool _isMutating = false;
  String _searchQuery = '';
  String? _errorMessage;

  List<UserModel> get contacts => List.unmodifiable(_contacts);
  List<UserModel> get suggestions => List.unmodifiable(_suggestions);
  bool get isLoading => _isLoading;
  bool get isSearching => _isSearching;
  bool get isMutating => _isMutating;
  String? get errorMessage => _errorMessage;
  String get searchQuery => _searchQuery;

  List<UserModel> get onlineContacts => _contacts.where((c) => c.isOnline).toList();

  /// Filter my own contacts by the in-screen search box.
  List<UserModel> get filtered {
    final query = _searchQuery.trim().toLowerCase();
    if (query.isEmpty) return contacts;
    return _contacts
        .where((c) =>
            c.displayName.toLowerCase().contains(query) ||
            (c.phone ?? '').toLowerCase().contains(query) ||
            (c.email ?? '').toLowerCase().contains(query))
        .toList();
  }

  void setSearchQuery(String value) {
    if (_searchQuery == value) return;
    _searchQuery = value;
    notifyListeners();
  }

  // ------------------------------------------------------------- my contacts
  Future<bool> loadContacts() async {
    if (_auth.token == null) {
      _setError('You are not signed in.');
      return false;
    }

    _isLoading = true;
    notifyListeners();

    final response = await _api.get('/api/contacts');
    _isLoading = false;

    if (response.ok && response.data is List) {
      _contacts = (response.data as List)
          .whereType<Map>()
          .map((json) => UserModel.fromJson(Map<String, dynamic>.from(json)))
          .where((u) => u.id.isNotEmpty)
          .toList();
      _errorMessage = null;
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  Future<bool> addContact(String userId) async {
    _isMutating = true;
    notifyListeners();

    final response = await _api.post('/api/contacts', body: {'userId': userId});
    _isMutating = false;

    if (response.ok) {
      await loadContacts();
      // A new contact is no longer a suggestion.
      _suggestions.removeWhere((s) => s.id == userId);
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  Future<bool> removeContact(String userId) async {
    _isMutating = true;
    notifyListeners();

    final response = await _api.delete('/api/contacts/$userId');
    _isMutating = false;

    if (response.ok) {
      _contacts.removeWhere((c) => c.id == userId);
      notifyListeners();
      return true;
    }

    _setError(response.errorMessage);
    return false;
  }

  bool isContact(String userId) => _contacts.any((c) => c.id == userId);

  // ---------------------------------------------------------------- directory
  /// Search the whole directory (people to add), not just my contacts.
  Future<List<DirectoryResult>> searchDirectory(String query) async {
    if (query.trim().isEmpty) return const [];

    _isSearching = true;
    notifyListeners();

    final response = await _api.get('/api/contacts/search', query: {'query': query.trim()});

    _isSearching = false;
    notifyListeners();

    if (response.ok && response.data is List) {
      return (response.data as List)
          .whereType<Map>()
          .map((json) => DirectoryResult.fromJson(Map<String, dynamic>.from(json)))
          .toList();
    }

    _setError(response.errorMessage);
    return const [];
  }

  /// People I already have a conversation with but have not added yet.
  Future<void> loadSuggestions() async {
    final response = await _api.get('/api/contacts/suggestions');
    if (response.ok && response.data is List) {
      _suggestions = (response.data as List)
          .whereType<Map>()
          .map((json) => UserModel.fromJson(Map<String, dynamic>.from(json)))
          .where((u) => u.id.isNotEmpty)
          .toList();
      notifyListeners();
    }
  }

  /// Single user for the profile screen; falls back to the cached list.
  Future<UserModel?> fetchUser(String userId) async {
    final response = await _api.get('/api/users/$userId');
    if (response.ok && response.data is Map) {
      return UserModel.fromJson(Map<String, dynamic>.from(response.data as Map));
    }
    for (final contact in _contacts) {
      if (contact.id == userId) return contact;
    }
    return null;
  }

  /// Kept for callers that still want raw user search.
  Future<List<UserModel>> searchUsers(String query) async {
    final results = await searchDirectory(query);
    return results.map((r) => r.user).toList();
  }

  void clearError() {
    _errorMessage = null;
    notifyListeners();
  }

  void _setError(String message) {
    _errorMessage = message;
    notifyListeners();
  }
}
