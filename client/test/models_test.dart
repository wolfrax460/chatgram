import 'package:chatgram/server_config.dart';
import 'package:chatgram/shared/models/chat_model.dart';
import 'package:chatgram/shared/models/message_model.dart';
import 'package:chatgram/shared/models/user_model.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ServerConfig.resolveMedia', () {
    test('returns empty string for null/empty', () {
      expect(ServerConfig.resolveMedia(null), '');
      expect(ServerConfig.resolveMedia(''), '');
      expect(ServerConfig.resolveMedia('   '), '');
    });

    test('prefixes server-relative paths with the API base URL', () {
      // Regression: avatars/media were passed straight to NetworkImage and
      // therefore never loaded, because the server returns relative paths.
      expect(
        ServerConfig.resolveMedia('/uploads/media/a.jpg'),
        '${ServerConfig.apiBaseUrl}/uploads/media/a.jpg',
      );
      expect(
        ServerConfig.resolveMedia('uploads/avatars/b.png'),
        '${ServerConfig.apiBaseUrl}/uploads/avatars/b.png',
      );
    });

    test('leaves absolute and data URLs untouched', () {
      expect(ServerConfig.resolveMedia('https://cdn.example.com/a.png'),
          'https://cdn.example.com/a.png');
      expect(ServerConfig.resolveMedia('data:image/png;base64,AAA'),
          'data:image/png;base64,AAA');
    });
  });

  group('UserModel', () {
    test('parses a fully populated user', () {
      final user = UserModel.fromJson({
        '_id': 'u1',
        'displayName': 'Alice Smith',
        'avatarUrl': '/uploads/avatars/a.png',
        'isOnline': true,
        'lastSeen': '2026-01-02T03:04:05.000Z',
      });

      expect(user.id, 'u1');
      expect(user.isOnline, isTrue);
      expect(user.initials, 'AS');
      expect(user.resolvedAvatarUrl, contains('/uploads/avatars/a.png'));
      expect(user.lastSeen, isNotNull);
    });

    test('falls back safely when fields are missing', () {
      // Regression: the auth payload only sends `id`, not `_id`/timestamps.
      final user = UserModel.fromJson({'id': 'u2', 'displayName': 'Bob'});

      expect(user.id, 'u2');
      expect(user.isOnline, isFalse);
      expect(user.avatarUrl, '');
      expect(user.createdAt, isNotNull);
      expect(user.initials, 'B');
    });

    test('initials never throw on a blank name', () {
      final user = UserModel.fromJson({'_id': 'u3', 'displayName': '   '});
      expect(user.initials, '?');
    });
  });

  group('MessageModel', () {
    test('parses a populated senderId object', () {
      final message = MessageModel.fromJson({
        '_id': 'm1',
        'chatId': 'c1',
        'senderId': {'_id': 'u1', 'displayName': 'Alice'},
        'type': 'text',
        'content': 'hi',
        'sentAt': '2026-01-02T03:04:05.000Z',
      });

      expect(message.senderId, 'u1');
      expect(message.type, MessageType.text);
      expect(message.content, 'hi');
    });

    test('statusFor reports read only when another participant read it', () {
      final base = MessageModel.fromJson({
        '_id': 'm1',
        'chatId': 'c1',
        'senderId': 'me',
        'type': 'text',
        'content': 'hi',
      });

      expect(base.statusFor('me', ['me', 'them']), MessageStatus.sent);

      final delivered = base.copyWith(deliveredTo: ['me', 'them']);
      expect(delivered.statusFor('me', ['me', 'them']), MessageStatus.delivered);

      final read = base.copyWith(readBy: ['me', 'them']);
      expect(read.statusFor('me', ['me', 'them']), MessageStatus.read);
    });

    test('an optimistic message reports "sending"', () {
      final local = MessageModel(
        id: 'local-c123',
        clientId: 'c123',
        chatId: 'c1',
        senderId: 'me',
        type: MessageType.text,
        content: 'hi',
        sentAt: DateTime.now(),
        deliveredTo: const [],
        readBy: const [],
      );

      expect(local.isPending, isTrue);
      expect(local.statusFor('me', ['me', 'them']), MessageStatus.sending);
    });

    test('a failed message reports "failed" regardless of receipts', () {
      final failed = MessageModel(
        id: 'local-c123',
        chatId: 'c1',
        senderId: 'me',
        type: MessageType.text,
        content: 'hi',
        sentAt: DateTime.now(),
        deliveredTo: const ['them'],
        readBy: const ['them'],
        failed: true,
      );

      expect(failed.statusFor('me', ['me', 'them']), MessageStatus.failed);
    });

    test('resolves relative media URLs', () {
      final message = MessageModel.fromJson({
        '_id': 'm2',
        'chatId': 'c1',
        'senderId': 'u1',
        'type': 'image',
        'mediaUrl': '/uploads/media/pic.png',
      });

      expect(message.resolvedMediaUrl, '${ServerConfig.apiBaseUrl}/uploads/media/pic.png');
    });
  });

  group('ChatModel', () {
    test('direct chat title is the other participant', () {
      final chat = ChatModel.fromJson({
        '_id': 'c1',
        'type': 'direct',
        'participants': [
          {'_id': 'me', 'displayName': 'Me'},
          {'_id': 'them', 'displayName': 'Bob Jones'},
        ],
      });

      expect(chat.displayTitle('me'), 'Bob Jones');
      expect(chat.initialsFor('me'), 'BJ');
      expect(chat.otherParticipant('me')?.id, 'them');
    });

    test('group chat title uses groupName and counts members', () {
      final chat = ChatModel.fromJson({
        '_id': 'c2',
        'type': 'group',
        'groupName': 'Team',
        'participants': [
          {'_id': 'me', 'displayName': 'Me'},
          {'_id': 'a', 'displayName': 'A'},
        ],
        'groupAdmins': ['me'],
      });

      expect(chat.displayTitle('me'), 'Team');
      expect(chat.isGroup, isTrue);
      expect(chat.adminIds, ['me']);
    });

    test('reads unreadCount and the populated lastMessage', () {
      final chat = ChatModel.fromJson({
        '_id': 'c3',
        'type': 'direct',
        'participants': [
          {'_id': 'me', 'displayName': 'Me'},
          {'_id': 'them', 'displayName': 'Bob'},
        ],
        'unreadCount': 4,
        'lastMessage': {
          '_id': 'm9',
          'content': 'see you',
          'type': 'text',
          'senderId': {'_id': 'them', 'displayName': 'Bob'},
          'sentAt': '2026-01-02T03:04:05.000Z',
        },
      });

      expect(chat.unreadCount, 4);
      expect(chat.lastMessage?.id, 'm9');
      expect(chat.lastMessage?.content, 'see you');
      expect(chat.lastMessage?.senderId, 'them');
    });

    test('handles un-populated participant id strings', () {
      final chat = ChatModel.fromJson({
        '_id': 'c4',
        'type': 'direct',
        'participants': ['me', 'them'],
      });

      expect(chat.participantIds, ['me', 'them']);
      expect(chat.otherParticipant('me')?.id, 'them');
    });
  });
}
