import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../core/theme.dart';
import '../../home/home_shell.dart';
import '../../onboarding/landing_screen.dart';
import '../../settings/services/settings_service.dart';
import '../services/auth_service.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Decides what '/' shows:
///   * a splash while the saved session is restored,
///   * the app shell when signed in,
///   * the WhatsApp-style welcome screen the first time,
///   * the login screen otherwise.
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _restoring = true;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    // Capture the services before awaiting so no BuildContext is used across
    // an async gap. Preferences drive the landing screen and the theme, so
    // they are loaded first.
    final settings = context.read<SettingsService>();
    final auth = context.read<AuthService>();
    await settings.loadSettings();
    await auth.loadUserFromStorage();
    // Public server settings (e.g. whether verification is mandatory) so the
    // sign-up screen can adapt before the user hits an error.
    await auth.loadServerConfig();
    if (mounted) setState(() => _restoring = false);
  }

  Future<void> _leaveLanding(String route) async {
    final navigator = Navigator.of(context);
    await context.read<SettingsService>().markWelcomeSeen();
    if (!mounted) return;
    navigator.pushReplacementNamed(route);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    final settings = context.watch<SettingsService>();

    if (_restoring || (auth.isLoading && !auth.isAuthenticated)) {
      return const _SplashScreen();
    }

    if (auth.isAuthenticated) return const HomeShell();

    if (!settings.hasSeenWelcome) {
      return LandingScreen(
        onContinue: () => _leaveLanding('/login'),
        onCreateAccount: () => _leaveLanding('/register'),
      );
    }

    return const _SignedOutRedirect();
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.teal,
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircleAvatar(
              radius: 46,
              backgroundColor: Colors.white,
              child: FaIcon(AppIcons.chat, size: 50, color: AppColors.teal),
            ),
            SizedBox(height: 24),
            Text(
              'Chatgram',
              style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w700),
            ),
            SizedBox(height: 28),
            SizedBox(
              width: 26,
              height: 26,
              child: CircularProgressIndicator(strokeWidth: 2.6, color: Colors.white),
            ),
          ],
        ),
      ),
    );
  }
}

/// The login screen, rendered inside this route rather than pushed, so the
/// back button cannot return to the splash.
class _SignedOutRedirect extends StatefulWidget {
  const _SignedOutRedirect();

  @override
  State<_SignedOutRedirect> createState() => _SignedOutRedirectState();
}

class _SignedOutRedirectState extends State<_SignedOutRedirect> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) Navigator.of(context).pushReplacementNamed('/login');
    });
  }

  @override
  Widget build(BuildContext context) => const _SplashScreen();
}
