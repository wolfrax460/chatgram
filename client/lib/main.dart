import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/routes.dart';
import 'core/theme.dart';
import 'features/auth/services/auth_service.dart';
import 'features/chat/services/chat_service.dart';
import 'features/contacts/services/contacts_service.dart';
import 'features/settings/services/privacy_service.dart';
import 'features/settings/services/settings_service.dart';
import 'features/settings/services/version_service.dart';
import 'features/status/services/status_service.dart';
import 'shared/widgets/server_status_banner.dart';
import 'server_config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // A server address saved on this device wins; otherwise auto-detect it.
  // On web this detects whether the page was served by the API itself or by a
  // plain static server, so the app works either way.
  await ServerConfig.loadSavedServer();
  await ServerConfig.initialize();

  // A single AuthService owns the one ApiClient, so the access token and the
  // transparent refresh logic live in exactly one place. Every other service
  // receives that same instance.
  final authService = AuthService();

  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthService>.value(value: authService),
        ChangeNotifierProvider<ChatService>(create: (_) => ChatService(authService)),
        ChangeNotifierProvider<ContactsService>(create: (_) => ContactsService(authService)),
        ChangeNotifierProvider<StatusService>(create: (_) => StatusService(authService)),
        ChangeNotifierProvider<SettingsService>(create: (_) => SettingsService()),
        ChangeNotifierProvider<PrivacyService>(
          create: (_) => PrivacyService(authService),
        ),
        ChangeNotifierProvider<VersionService>(
          create: (_) => VersionService(authService.api),
        ),
      ],
      child: const ChatgramApp(),
    ),
  );
}

class ChatgramApp extends StatelessWidget {
  const ChatgramApp({super.key});

  @override
  Widget build(BuildContext context) {
    // The settings service drives the theme mode.
    return Consumer<SettingsService>(
      builder: (context, settings, _) {
        return MaterialApp(
          title: 'Chatgram',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.lightTheme,
          darkTheme: AppTheme.darkTheme,
          themeMode: settings.themeMode,
          initialRoute: AppRoutes.home,
          routes: AppRoutes.routes,
          onGenerateRoute: AppRoutes.onGenerateRoute,
          scrollBehavior: const _AppScrollBehavior(),
          // Sits above every screen, including sign-in, so "cannot reach the
          // server" is explained instead of looking like a frozen app.
          builder: (context, child) => Column(
            children: [
              const ServerStatusBanner(),
              Expanded(child: child ?? const SizedBox.shrink()),
            ],
          ),
        );
      },
    );
  }
}

/// Lets desktop and web users drag-scroll with a mouse/trackpad.
class _AppScrollBehavior extends MaterialScrollBehavior {
  const _AppScrollBehavior();

  @override
  Set<PointerDeviceKind> get dragDevices => {
        PointerDeviceKind.touch,
        PointerDeviceKind.mouse,
        PointerDeviceKind.trackpad,
        PointerDeviceKind.stylus,
      };
}
