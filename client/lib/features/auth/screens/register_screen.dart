import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import '../validators.dart';
import 'auth_scaffold.dart';
import '../../../shared/widgets/google_sign_in_button.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key});

  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _displayNameController = TextEditingController();
  final _identifierController = TextEditingController();
  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  bool _obscure = true;
  bool _obscureConfirm = true;
  bool _sendingCode = false;
  bool _verifying = false;
  bool _codeSent = false;
  bool _verified = false;
  String? _devCode;
  String? _localError;

  @override
  void dispose() {
    _displayNameController.dispose();
    _identifierController.dispose();
    _codeController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------ validation
  // The rules live in AuthValidators so they can be unit tested directly.
  static String normalizeIdentifier(String value) =>
      AuthValidators.normalizeIdentifier(value);

  String? _validateIdentifier(String? value) => AuthValidators.identifierError(value);

  String? _validatePassword(String? value) => AuthValidators.passwordError(value);

  String? _validateConfirm(String? value) =>
      AuthValidators.confirmPasswordError(value, _passwordController.text);

  // ------------------------------------------------------------ actions
  Future<void> _sendCode() async {
    final identifier = _identifierController.text.trim();
    final problem = _validateIdentifier(identifier);
    if (problem != null) {
      setState(() => _localError = problem);
      return;
    }

    setState(() {
      _sendingCode = true;
      _localError = null;
    });

    final auth = context.read<AuthService>();
    final result = await auth.sendVerificationCode(normalizeIdentifier(identifier));

    if (!mounted) return;
    setState(() {
      _sendingCode = false;
      if (result != null) {
        _codeSent = true;
        _verified = false;
        _devCode = result['devCode']?.toString();
      } else {
        _localError = auth.errorMessage;
      }
    });

    if (!mounted || result == null) return;
    final devCode = _devCode;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 8),
        content: Text(
          devCode != null
              // No mail/SMS provider is configured, so the server handed the
              // code back for testing.
              ? 'Development mode — your code is $devCode'
              : (result['message']?.toString() ?? 'Verification code sent'),
        ),
      ),
    );
  }

  Future<void> _verifyCode() async {
    final code = _codeController.text.trim();
    if (!RegExp(r'^[0-9]{6}$').hasMatch(code)) {
      setState(() => _localError = 'Enter the 6-digit code');
      return;
    }

    setState(() {
      _verifying = true;
      _localError = null;
    });

    final auth = context.read<AuthService>();
    final ok = await auth.verifyCode(
      normalizeIdentifier(_identifierController.text),
      code,
    );

    if (!mounted) return;
    setState(() {
      _verifying = false;
      _verified = ok;
      if (!ok) _localError = auth.errorMessage;
    });

    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Verified ✓')),
      );
    }
  }

  Future<void> _register() async {
    // Clear a stale server error before re-validating.
    context.read<AuthService>().clearError();

    if (!_formKey.currentState!.validate()) return;

    final auth = context.read<AuthService>();

    final success = await auth.register(
      displayName: _displayNameController.text.trim(),
      identifier: normalizeIdentifier(_identifierController.text),
      password: _passwordController.text,
    );

    if (!mounted) return;
    if (success) {
      Navigator.of(context).pushNamedAndRemoveUntil('/', (_) => false);
    }
  }

  Future<void> _googleSignIn() async {
    final auth = context.read<AuthService>();
    final navigator = Navigator.of(context);

    // Signing in with Google creates the account if it does not exist, so this
    // doubles as "sign up with Google".
    final ok = await auth.signInWithGoogle();
    if (!mounted) return;
    if (ok) navigator.pushNamedAndRemoveUntil('/', (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();

    return AuthScaffold(
      title: 'Create your account',
      subtitle: 'Join Chatgram and start messaging',
      children: [
        Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_localError != null) AuthErrorBanner(message: _localError!),
              if (auth.errorMessage != null) AuthErrorBanner(message: auth.errorMessage!),

              TextFormField(
                controller: _displayNameController,
                autofocus: true,
                textInputAction: TextInputAction.next,
                textCapitalization: TextCapitalization.words,
                decoration: const InputDecoration(
                  labelText: 'Display name',
                  prefixIcon: FaIcon(AppIcons.badge),
                ),
                validator: (value) {
                  final text = (value ?? '').trim();
                  if (text.isEmpty) return 'Enter a display name';
                  if (text.length < 2) return 'At least 2 characters';
                  return null;
                },
              ),
              const SizedBox(height: 14),

              // ------------------------------------------------- identifier
              TextFormField(
                controller: _identifierController,
                textInputAction: TextInputAction.next,
                keyboardType: TextInputType.emailAddress,
                enabled: !_verified,
                onChanged: (_) {
                  if (_codeSent && !_verified) {
                    setState(() {
                      _codeSent = false;
                      _devCode = null;
                      _codeController.clear();
                    });
                  }
                },
                decoration: InputDecoration(
                  labelText: 'Email or phone',
                  prefixIcon: const FaIcon(AppIcons.email),
                  helperText: _verified
                      ? 'Verified ✓'
                      : 'We will send a 6-digit code to confirm it',
                  helperStyle: _verified
                      ? const TextStyle(color: Color(0xFF25D366), fontWeight: FontWeight.w600)
                      : null,
                  suffixIcon: _verified
                      ? const FaIcon(AppIcons.verified, color: Color(0xFF25D366))
                      : TextButton(
                          onPressed: _sendingCode ? null : _sendCode,
                          child: _sendingCode
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : Text(_codeSent ? 'Resend' : 'Send code'),
                        ),
                ),
                validator: _validateIdentifier,
              ),

              // ------------------------------------------------- code entry
              if (_codeSent && !_verified) ...[
                const SizedBox(height: 14),
                TextFormField(
                  controller: _codeController,
                  keyboardType: TextInputType.number,
                  maxLength: 6,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: InputDecoration(
                    labelText: '6-digit code',
                    prefixIcon: const FaIcon(AppIcons.password),
                    counterText: '',
                    helperText: _devCode != null
                        ? 'Development mode code: $_devCode'
                        : 'Check your messages for the code',
                    suffixIcon: TextButton(
                      onPressed: _verifying ? null : _verifyCode,
                      child: _verifying
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Verify'),
                    ),
                  ),
                ),
              ],

              const SizedBox(height: 14),
              TextFormField(
                controller: _passwordController,
                obscureText: _obscure,
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(
                  labelText: 'Password',
                  prefixIcon: const FaIcon(AppIcons.lock),
                  helperText: 'At least 6 characters',
                  suffixIcon: IconButton(
                    icon: FaIcon(_obscure ? AppIcons.visibilityOff : AppIcons.visibility),
                    onPressed: () => setState(() => _obscure = !_obscure),
                  ),
                ),
                validator: _validatePassword,
              ),
              const SizedBox(height: 14),
              TextFormField(
                controller: _confirmController,
                obscureText: _obscureConfirm,
                textInputAction: TextInputAction.done,
                onFieldSubmitted: (_) => _register(),
                decoration: InputDecoration(
                  labelText: 'Confirm password',
                  prefixIcon: const FaIcon(AppIcons.password),
                  suffixIcon: IconButton(
                    icon: FaIcon(_obscureConfirm ? AppIcons.visibilityOff : AppIcons.visibility),
                    onPressed: () => setState(() => _obscureConfirm = !_obscureConfirm),
                  ),
                ),
                validator: _validateConfirm,
              ),

              if (auth.verificationRequired && !_verified) ...[
                const SizedBox(height: 14),
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: Colors.orange.withValues(alpha: 0.14),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Row(
                    children: [
                      FaIcon(AppIcons.info, size: 18, color: Colors.orange),
                      SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'This server requires a verified email or phone. '
                          'Tap "Send code" above and enter the code we email you.',
                          style: TextStyle(fontSize: 12.5),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 22),
              FilledButton(
                onPressed: (auth.isLoading || (auth.verificationRequired && !_verified))
                    ? null
                    : _register,
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
                    : const Text('Create account', style: TextStyle(fontSize: 16)),
              ),
              const SizedBox(height: 14),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  const Text('Already have an account?'),
                  TextButton(
                    onPressed: auth.isLoading
                        ? null
                        : () => Navigator.of(context).pushNamed('/login'),
                    child: const Text('Sign in'),
                  ),
                ],
              ),

              // Google sign-up sits below the primary email flow.
              if (auth.googleUsable) ...[
                const SizedBox(height: 16),
                const OrDivider(label: 'or'),
                const SizedBox(height: 14),
                GoogleSignInButton(
                  label: 'Sign up with Google',
                  isLoading: auth.googleSignInInProgress,
                  onPressed: _googleSignIn,
                ),
              ] else if (auth.googleEnabled && auth.googleUnavailableReason != null) ...[
                const SizedBox(height: 16),
                // Configured on the server, but this device cannot finish the flow.
                GoogleUnavailableNote(message: auth.googleUnavailableReason!),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
