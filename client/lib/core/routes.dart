import 'package:flutter/material.dart';

import '../features/auth/screens/auth_gate.dart';
import '../features/auth/screens/forgot_password_screen.dart';
import '../features/auth/screens/login_screen.dart';
import '../features/auth/screens/register_screen.dart';
import '../features/chat/screens/chat_detail_screen.dart';
import '../features/profile/screens/profile_screen.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

class AppRoutes {
  static const String login = '/login';
  static const String register = '/register';
  static const String forgotPassword = '/forgot-password';
  static const String home = '/';
  static const String chatDetail = '/chat/:chatId';
  static const String profile = '/user/:userId';

  static final Map<String, WidgetBuilder> routes = {
    home: (context) => const AuthGate(),
    login: (context) => const LoginScreen(),
    register: (context) => const RegisterScreen(),
    forgotPassword: (context) => const ForgotPasswordScreen(),
  };

  static Route<dynamic> onGenerateRoute(RouteSettings settings) {
    final name = settings.name;

    if (name != null && name.startsWith('/chat/')) {
      final chatId = (settings.arguments as String?) ??
          name.substring('/chat/'.length);
      return MaterialPageRoute(
        builder: (_) => ChatDetailScreen(chatId: chatId),
        settings: settings,
      );
    }

    if (name != null && name.startsWith('/user/')) {
      final userId = (settings.arguments as String?) ??
          name.substring('/user/'.length);
      return MaterialPageRoute(
        builder: (_) => ProfileScreen(userId: userId),
        settings: settings,
      );
    }

    return MaterialPageRoute(
      builder: (_) => const _NotFoundScreen(),
      settings: settings,
    );
  }
}

class _NotFoundScreen extends StatelessWidget {
  const _NotFoundScreen();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Not found')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const FaIcon(AppIcons.location, size: 64, color: Colors.grey),
            const SizedBox(height: 16),
            const Text('This page does not exist.'),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: () => Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false),
              child: const Text('Go home'),
            ),
          ],
        ),
      ),
    );
  }
}
