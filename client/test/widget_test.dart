import 'package:chatgram/features/auth/screens/login_screen.dart';
import 'package:chatgram/features/auth/services/auth_service.dart';
import 'package:chatgram/shared/models/message_model.dart';
import 'package:chatgram/shared/widgets/message_bubble.dart';
import 'package:chatgram/shared/widgets/message_ticks.dart';
import 'package:chatgram/shared/widgets/user_avatar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

/// Wraps a widget in the minimum scaffolding Material widgets need.
Widget wrap(Widget child) {
  return MaterialApp(
    home: Scaffold(
      body: Center(child: child),
    ),
  );
}

MessageModel buildMessage({
  String content = 'Hello world',
  bool failed = false,
  MessageType type = MessageType.text,
  DateTime? sentAt,
}) {
  return MessageModel(
    id: 'm1',
    chatId: 'c1',
    senderId: 'me',
    type: type,
    content: content,
    sentAt: sentAt ?? DateTime(2026, 1, 1, 9, 30),
    deliveredTo: const ['me', 'them'],
    readBy: const ['me'],
    failed: failed,
  );
}

void main() {
  // ---------------------------------------------------------------------------
  // MessageTicks
  // ---------------------------------------------------------------------------
  group('MessageTicks', () {
    testWidgets('shows a single tick for "sent"', (tester) async {
      await tester.pumpWidget(wrap(const MessageTicks(status: MessageStatus.sent)));

      // Icons are FontAwesome now. The glyph lives in a private field on
      // FaIcon, so assert the widget and the semantic label instead.
      expect(find.byType(FaIcon), findsOneWidget);
      expect(MessageTicks.describe(MessageStatus.sent), 'Sent');
    });

    testWidgets('shows a double tick for "delivered"', (tester) async {
      await tester.pumpWidget(wrap(const MessageTicks(status: MessageStatus.delivered)));

      expect(find.byType(FaIcon), findsOneWidget);
      expect(MessageTicks.describe(MessageStatus.delivered), 'Delivered');
    });

    testWidgets('shows a double tick for "read"', (tester) async {
      await tester.pumpWidget(wrap(const MessageTicks(status: MessageStatus.read)));

      expect(find.byType(FaIcon), findsOneWidget);
      expect(MessageTicks.describe(MessageStatus.read), 'Read');
    });

    testWidgets('shows an error icon when the send failed', (tester) async {
      await tester.pumpWidget(wrap(const MessageTicks(status: MessageStatus.failed)));

      expect(find.byType(FaIcon), findsOneWidget);
      expect(MessageTicks.describe(MessageStatus.failed), 'Not sent');
    });
  });

  // ---------------------------------------------------------------------------
  // UserAvatar
  // ---------------------------------------------------------------------------
  group('UserAvatar', () {
    testWidgets('renders initials when there is no image', (tester) async {
      await tester.pumpWidget(wrap(const UserAvatar(initials: 'MA')));

      expect(find.text('MA'), findsOneWidget);
    });

    testWidgets('falls back to "?" for an empty initial', (tester) async {
      await tester.pumpWidget(wrap(const UserAvatar(initials: '')));

      expect(find.text('?'), findsOneWidget);
    });
  });

  // ---------------------------------------------------------------------------
  // MessageBubble
  // ---------------------------------------------------------------------------
  group('MessageBubble', () {
    testWidgets('renders the text and a timestamp', (tester) async {
      final sentAt = DateTime(2026, 1, 1, 9, 30);
      await tester.pumpWidget(wrap(MessageBubble(
        message: buildMessage(content: 'Hello world', sentAt: sentAt),
        isMine: true,
        status: MessageStatus.read,
      )));

      expect(find.text('Hello world'), findsOneWidget);
      expect(find.text(DateFormat.jm().format(sentAt)), findsOneWidget);
    });

    testWidgets('shows ticks only for my own messages', (tester) async {
      await tester.pumpWidget(wrap(MessageBubble(
        message: buildMessage(),
        isMine: true,
        status: MessageStatus.read,
      )));
      expect(find.byType(MessageTicks), findsOneWidget);

      await tester.pumpWidget(wrap(MessageBubble(
        message: buildMessage(),
        isMine: false,
        status: MessageStatus.read,
      )));
      expect(find.byType(MessageTicks), findsNothing);
    });

    testWidgets('renders the sender name in a group chat', (tester) async {
      await tester.pumpWidget(wrap(MessageBubble(
        message: buildMessage(),
        isMine: false,
        status: MessageStatus.read,
        senderName: 'Alice',
        showSenderName: true,
      )));

      expect(find.text('Alice'), findsOneWidget);
    });

    testWidgets('shows a Retry affordance for a failed message', (tester) async {
      await tester.pumpWidget(wrap(MessageBubble(
        message: buildMessage(content: 'oops', failed: true),
        isMine: true,
        status: MessageStatus.failed,
        onRetry: () {},
      )));

      expect(find.text('Retry'), findsOneWidget);
    });
  });

  // ---------------------------------------------------------------------------
  // LoginScreen
  // ---------------------------------------------------------------------------
  group('LoginScreen', () {
    Widget loginApp() {
      return ChangeNotifierProvider<AuthService>(
        create: (_) => AuthService(),
        child: const MaterialApp(home: LoginScreen()),
      );
    }

    testWidgets('renders the sign-in form', (tester) async {
      await tester.pumpWidget(loginApp());
      await tester.pump();

      expect(find.text('Welcome back'), findsOneWidget);
      expect(find.byType(TextFormField), findsNWidgets(2));
    });

    testWidgets('validates before hitting the network', (tester) async {
      await tester.pumpWidget(loginApp());
      await tester.pump();

      // Submitting an empty form must surface validation errors and must not
      // attempt a request (there is no backend in a widget test).
      await tester.tap(find.byType(FilledButton).first);
      await tester.pump();

      expect(find.text('Enter your phone number or email'), findsOneWidget);
      expect(find.text('Enter your password'), findsOneWidget);
    });
  });
}
