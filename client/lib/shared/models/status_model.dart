import '../../server_config.dart';
import 'user_model.dart';

class StatusModel {
  final String id;
  final String userId;
  final UserModel? user;
  final String? text;
  final String? mediaUrl;
  final DateTime createdAt;
  final List<String> viewedBy;

  /// The same viewers as [viewedBy], but with names and avatars so the owner
  /// can see *who* saw the status rather than just a count.
  final List<UserModel> viewers;

  StatusModel({
    required this.id,
    required this.userId,
    this.user,
    this.text,
    this.mediaUrl,
    required this.createdAt,
    this.viewedBy = const [],
    this.viewers = const [],
  });

  factory StatusModel.fromJson(Map<String, dynamic> json) {
    final rawUser = json['userId'];
    UserModel? user;
    String userId = '';

    if (rawUser is Map) {
      user = UserModel.fromJson(Map<String, dynamic>.from(rawUser));
      userId = user.id;
    } else if (rawUser != null) {
      userId = rawUser.toString();
    }

    final rawViewed = json['viewedBy'] as List? ?? const [];
    final viewedBy = <String>[];
    final viewers = <UserModel>[];

    for (final entry in rawViewed) {
      if (entry is Map) {
        final viewer = UserModel.fromJson(Map<String, dynamic>.from(entry));
        if (viewer.id.isEmpty) continue;
        viewedBy.add(viewer.id);
        // Older payloads only had `_id`, which yields a blank name.
        if (viewer.displayName.isNotEmpty) viewers.add(viewer);
      } else if (entry != null) {
        final id = entry.toString();
        if (id.isNotEmpty) viewedBy.add(id);
      }
    }

    return StatusModel(
      id: (json['_id'] ?? json['id'] ?? '').toString(),
      userId: userId,
      user: user,
      text: json['text']?.toString(),
      mediaUrl: json['mediaUrl']?.toString(),
      createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ??
          DateTime.now(),
      viewedBy: viewedBy,
      viewers: viewers,
    );
  }

  String get resolvedMediaUrl => ServerConfig.resolveMedia(mediaUrl);
  bool get hasMedia => (mediaUrl?.isNotEmpty ?? false);
  bool get hasText => (text?.trim().isNotEmpty ?? false);

  String get displayName => user?.displayName.isNotEmpty == true ? user!.displayName : 'Unknown';
  String get initials => user?.initials ?? '?';

  bool isMine(String? currentUserId) => userId == currentUserId;
  bool isViewedBy(String? currentUserId) =>
      currentUserId != null && viewedBy.contains(currentUserId);

  /// Time remaining before the 24h TTL removes it.
  Duration get remaining {
    final expiry = createdAt.add(const Duration(hours: 24));
    final left = expiry.difference(DateTime.now());
    return left.isNegative ? Duration.zero : left;
  }
}
