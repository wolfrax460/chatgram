import '../../server_config.dart';

class UserModel {
  final String id;
  final String? phone;
  final String? email;
  final String displayName;
  final String avatarUrl;
  final String? about;
  final DateTime? lastSeen;
  final bool isOnline;
  final DateTime createdAt;
  final DateTime updatedAt;

  UserModel({
    required this.id,
    this.phone,
    this.email,
    required this.displayName,
    required this.avatarUrl,
    this.about,
    this.lastSeen,
    required this.isOnline,
    required this.createdAt,
    required this.updatedAt,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    return UserModel(
      id: (json['_id'] ?? json['id'] ?? '').toString(),
      phone: json['phone']?.toString(),
      email: json['email']?.toString(),
      displayName: (json['displayName'] ?? '').toString(),
      avatarUrl: (json['avatarUrl'] ?? '').toString(),
      about: json['about']?.toString(),
      lastSeen: _parseDate(json['lastSeen']),
      isOnline: json['isOnline'] == true,
      createdAt: _parseDate(json['createdAt']) ?? DateTime.now(),
      updatedAt: _parseDate(json['updatedAt']) ?? DateTime.now(),
    );
  }

  static DateTime? _parseDate(dynamic value) {
    if (value == null) return null;
    if (value is DateTime) return value;
    return DateTime.tryParse(value.toString())?.toLocal();
  }

  /// Absolute URL for the avatar, or empty when there is none.
  String get resolvedAvatarUrl => ServerConfig.resolveMedia(avatarUrl);

  /// Up to two initials for the avatar placeholder.
  String get initials {
    final trimmed = displayName.trim();
    if (trimmed.isEmpty) return '?';
    final parts = trimmed.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return _firstChar(parts.first);
    return '${_firstChar(parts.first)}${_firstChar(parts.last)}';
  }

  static String _firstChar(String value) =>
      value.isEmpty ? '?' : value.substring(0, 1).toUpperCase();

  String get handle => (phone?.isNotEmpty ?? false) ? phone! : (email ?? '');

  Map<String, dynamic> toJson() => {
        '_id': id,
        'phone': phone,
        'email': email,
        'displayName': displayName,
        'avatarUrl': avatarUrl,
        'about': about,
        'lastSeen': lastSeen?.toIso8601String(),
        'isOnline': isOnline,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };

  UserModel copyWith({
    String? id,
    String? phone,
    String? email,
    String? displayName,
    String? avatarUrl,
    String? about,
    DateTime? lastSeen,
    bool? isOnline,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return UserModel(
      id: id ?? this.id,
      phone: phone ?? this.phone,
      email: email ?? this.email,
      displayName: displayName ?? this.displayName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      about: about ?? this.about,
      lastSeen: lastSeen ?? this.lastSeen,
      isOnline: isOnline ?? this.isOnline,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
