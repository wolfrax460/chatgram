@Tags(['integration'])
library;

import 'dart:io';

import 'package:chatgram/shared/services/api_client.dart';
import 'package:chatgram/shared/models/chat_model.dart';
import 'package:chatgram/shared/models/message_model.dart';
import 'package:flutter_test/flutter_test.dart';

/// Live integration test: drives the real backend through the *same*
/// [ApiClient] the Flutter app uses.
///
/// Requires the API to be running:
///   cd server && npm start
/// Run with:
///   flutter test test/api_integration_test.dart --tags integration
///
/// This is what catches frontend/backend contract drift (response shapes,
/// auth headers, pagination) that pure unit tests cannot see.
void main() {
  // `flutter_test` installs an HttpOverrides mock that answers every request
  // with a fake 400. Clear it so the test can hit the real localhost server.
  setUpAll(() => HttpOverrides.global = null);

  const base = 'http://127.0.0.1:5001';

  // These tests need a running backend AND an explicit base URL: inside
  // `flutter test` the target platform looks like Android, so the default base
  // URL would be the emulator alias 10.0.2.2, which is unreachable from the
  // host. Skip unless the caller opted in, so `flutter test` stays green.
  const apiOverride = String.fromEnvironment('API_BASE_URL');
  const skipReason = apiOverride == ''
      ? 'Integration test — start the backend, then run:\n'
          '  flutter test test/api_integration_test.dart --tags integration '
          '--dart-define=API_BASE_URL=http://127.0.0.1:5001'
      : null;

  final api = ApiClient();

  void itest(String name, Future<void> Function() body) =>
      test(name, body, skip: skipReason);

  final stamp = DateTime.now().microsecondsSinceEpoch;
  final emailA = 'flutter.a.$stamp@example.com';
  final emailB = 'flutter.b.$stamp@example.com';

  late String tokenA;
  late String tokenB;
  late String idA;
  late String idB;
  late String chatId;

  itest('server is reachable before running the suite', () async {
    final health = await api.get('/api/health');
    // Surface the real transport error rather than a bare "expected true".
    expect(
      health.ok,
      isTrue,
      reason: 'status=${health.statusCode} message=${health.errorMessage} '
          'data=${health.data} base=$base',
    );
    expect(health.data['database'], 'connected');
  });

  itest('registers two users through AuthService-equivalent flow', () async {
    final a = await api.post('/api/auth/register', body: {
      'displayName': 'Flutter Alice',
      'identifier': emailA,
      'password': 'password123',
    });
    expect(a.statusCode, 201);
    tokenA = a.data['accessToken'];
    idA = a.data['user']['id'];
    expect(tokenA, isNotEmpty);

    final b = await api.post('/api/auth/register', body: {
      'displayName': 'Flutter Bob',
      'identifier': emailB,
      'password': 'password123',
    });
    expect(b.statusCode, 201);
    tokenB = b.data['accessToken'];
    idB = b.data['user']['id'];

    api.setTokens(accessToken: tokenA, refreshToken: a.data['refreshToken']);
  });

  itest('authenticated GET /api/auth/me works with the bearer token', () async {
    final me = await api.get('/api/auth/me');
    expect(me.ok, isTrue);
    expect(me.data['_id'] ?? me.data['id'], idA);
  });

  itest('loads contacts (users) and parses them into ChatModel-ready users',
      () async {
    final users = await api.get('/api/users');
    expect(users.ok, isTrue);
    expect(users.data, isA<List>());
    expect(
      (users.data as List).any((u) => u['_id'] == idB),
      isTrue,
      reason: 'user B should be listed as a contact',
    );
  });

  itest('creates a direct chat and parses it with ChatModel', () async {
    final response = await api.post('/api/chats', body: {
      'type': 'direct',
      'participantId': idB,
    });
    expect(response.ok, isTrue);

    final chat = ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map));
    expect(chat.id, isNotEmpty);
    expect(chat.isDirect, isTrue);
    expect(chat.displayTitle(idA), 'Flutter Bob');
    expect(chat.participants.length, 2);
    chatId = chat.id;
  });

  itest('sends a message and reads it back oldest-first', () async {
    final sent = await api.post('/api/messages', body: {
      'chatId': chatId,
      'type': 'text',
      'content': 'hello from the flutter client',
    });
    expect(sent.statusCode, 201);

    for (var i = 1; i <= 3; i++) {
      await api.post('/api/messages', body: {
        'chatId': chatId,
        'type': 'text',
        'content': 'msg $i',
      });
    }

    final response = await api.get('/api/messages', query: {
      'chatId': chatId,
      'limit': 2,
    });
    expect(response.ok, isTrue);

    final body = Map<String, dynamic>.from(response.data as Map);
    final list = (body['messages'] as List)
        .map((e) => MessageModel.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();

    expect(list.length, 2);
    // Newest page, chronological order.
    expect(list.first.content, 'msg 2');
    expect(list.last.content, 'msg 3');
    expect(body.containsKey('hasMore'), isTrue);
    expect(body['nextCursor'], isNotNull);
  });

  itest('parses a populated sender object into MessageModel.senderId', () async {
    final response = await api.get('/api/messages', query: {'chatId': chatId});
    final list = (response.data['messages'] as List)
        .map((e) => MessageModel.fromJson(Map<String, dynamic>.from(e as Map)))
        .toList();

    expect(list, isNotEmpty);
    expect(list.first.senderId, idA);
    expect(list.first.type, MessageType.text);
  });

  itest('mark-chat-as-read endpoint works', () async {
    final response = await api.post('/api/messages/chat/$chatId/read');
    expect(response.ok, isTrue);
  });

  itest('token refresh returns a rotated pair', () async {
    final login = await api.post('/api/auth/login', body: {
      'identifier': emailA,
      'password': 'password123',
    });
    final refreshToken = login.data['refreshToken'];

    final refreshed = await api.post('/api/auth/refresh', body: {'token': refreshToken});
    expect(refreshed.ok, isTrue);
    expect(refreshed.data['accessToken'], isNotEmpty);
    expect(refreshed.data['refreshToken'], isNotEmpty);
  });

  itest('rejects a request with a bogus token', () async {
    final anonymous = ApiClient()..setTokens(accessToken: 'not-a-real-token');
    final response = await anonymous.get('/api/auth/me');
    expect(response.statusCode, 401);
  });

  itest('creates a group chat (regression: used to return 500)', () async {
    final response = await api.post('/api/chats', body: {
      'type': 'group',
      'groupName': 'Flutter Group',
      'participantIds': [idB],
    });

    expect(response.statusCode, 201, reason: response.errorMessage);
    final chat = ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map));
    expect(chat.isGroup, isTrue);
    expect(chat.displayTitle(idA), 'Flutter Group');
    expect(chat.participants.length, 2);
  });

  itest('surfaces a readable error for a wrong password', () async {
    final fresh = ApiClient();
    final response = await fresh.post('/api/auth/login', body: {
      'identifier': emailA,
      'password': 'definitely-wrong',
    });
    expect(response.statusCode, 401);
    expect(response.errorMessage, isNotEmpty);
    expect(response.errorMessage, isNot(contains('Request failed')));
  });

  itest('the other participant sees the same chat from their own token',
      () async {
    final asB = ApiClient()..setTokens(accessToken: tokenB);
    final response = await asB.get('/api/chats/$chatId');

    expect(response.ok, isTrue, reason: response.errorMessage);
    final chat = ChatModel.fromJson(Map<String, dynamic>.from(response.data as Map));
    // From Bob's perspective the chat is titled with Alice's name.
    expect(chat.displayTitle(idB), 'Flutter Alice');
  });

  tearDownAll(() async {
    // Nothing was initialised when the suite was skipped.
    if (skipReason != null) return;
    // Log user A out so the presence flag does not linger.
    api.setTokens(accessToken: tokenA);
    await api.post('/api/auth/logout');
  });
}
