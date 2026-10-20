import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../shared/widgets/google_sign_in_button.dart';
import '../services/auth_service.dart';
import 'auth_scaffold.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifierController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscure = true;

  @override
  void dispose() {
    _identifierController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;

    final auth = context.read<AuthService>();
    final success = await auth.login(
      _identifierController.text.trim(),
      _passwordController.text,
    );

    if (!mounted) return;
    if (success) {
      Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
    }
  }

  Future<void> _googleSignIn() async {
    final auth = context.read<AuthService>();
    final navigator = Navigator.of(context);

    final ok = await auth.signInWithGoogle();
    if (!mounted) return;
    if (ok) navigator.pushNamedAndRemoveUntil('/', (_) => false);
    // Failures surface through auth.errorMessage in the banner below.
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();

    return AuthScaffold(
      title: 'Welcome back',
      subtitle: 'Sign in with your phone number or email',
      children: [
        Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (auth.errorMessage != null) AuthErrorBanner(message: auth.errorMessage!),
              TextFormField(
                controller: _identifierController,
                autofocus: true,
                textInputAction: TextInputAction.next,
                keyboardType: TextInputType.emailAddress,
                decoration: const InputDecoration(
                  labelText: 'Phone or email',
                  prefixIcon: FaIcon(AppIcons.person),
                ),
                validator: (value) {
                  if (value == null || value.trim().isEmpty) {
                    return 'Enter your phone number or email';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _passwordController,
                obscureText: _obscure,
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _login(),
                decoration: InputDecoration(
                  labelText: 'Password',
                  prefixIcon: const FaIcon(AppIcons.lock),
                  suffixIcon: IconButton(
                    icon: FaIcon(_obscure ? AppIcons.visibilityOff : AppIcons.visibility),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) return 'Enter your password';
                  return null;
                },
              ),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: auth.isLoading
                      ? null
                      : () => Navigator.of(context).pushNamed('/forgot-password'),
                  child: const Text('Forgot password?'),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                onPressed: auth.isLoading ? null : _login,
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF008069),
                  minimumSize: const Size.fromHeight(50),
                ),
                child: auth.isLoading
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
                      )
                    : const Text('Sign in', style: TextStyle(fontSize: 16)),
              ),
              const SizedBox(height: 14),
              // Wrap (not Row) so the prompt + button never overflow on a
              // narrow screen or with a large text scale.
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text("Don't have an account?"),
                  TextButton(
                    onPressed: auth.isLoading
                        ? null
                        : () => Navigator.of(context).pushNamed('/register'),
                    child: const Text('Create one'),
                  ),
                ],
              ),
              const SizedBox(height: 4),

              // Google sign-in is a secondary option, so it sits below the
              // primary email/password flow rather than above it.
              if (auth.googleUsable) ...[
                const SizedBox(height: 16),
                const OrDivider(label: 'or'),
                const SizedBox(height: 14),
                GoogleSignInButton(
                  isLoading: auth.googleSignInInProgress,
                  onPressed: _googleSignIn,
                ),
              ] else if (auth.googleEnabled && auth.googleUnavailableReason != null) ...[
                const SizedBox(height: 16),
                // Google is set up on the server, but this device cannot
                // complete the round-trip — explain instead of hanging.
                GoogleUnavailableNote(message: auth.googleUnavailableReason!),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
