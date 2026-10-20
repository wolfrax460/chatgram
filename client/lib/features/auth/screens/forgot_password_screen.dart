import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../services/auth_service.dart';
import '../validators.dart';
import 'auth_scaffold.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Two-step password reset: request a code, then set a new password.
class ForgotPasswordScreen extends StatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  State<ForgotPasswordScreen> createState() => _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends State<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _identifierController = TextEditingController();
  final _codeController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();

  bool _codeSent = false;
  bool _sending = false;
  bool _submitting = false;
  bool _obscure = true;
  String? _devCode;
  String? _localError;

  @override
  void dispose() {
    _identifierController.dispose();
    _codeController.dispose();
    _passwordController.dispose();
    _confirmController.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final identifier = _identifierController.text.trim();
    if (!AuthValidators.isValidIdentifier(identifier)) {
      setState(() => _localError =
          AuthValidators.identifierError(identifier));
      return;
    }

    setState(() {
      _sending = true;
      _localError = null;
    });

    final auth = context.read<AuthService>();
    final result = await auth.requestPasswordReset(
      AuthValidators.normalizeIdentifier(identifier),
    );

    if (!mounted) return;
    setState(() {
      _sending = false;
      if (result != null) {
        _codeSent = true;
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
              ? 'Development mode — your reset code is $devCode'
              : (result['message']?.toString() ?? 'Reset code sent'),
        ),
      ),
    );
  }

  Future<void> _resetPassword() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _submitting = true;
      _localError = null;
    });

    final auth = context.read<AuthService>();
    final navigator = Navigator.of(context);
    final messenger = ScaffoldMessenger.of(context);

    final ok = await auth.resetPassword(
      target: AuthValidators.normalizeIdentifier(_identifierController.text),
      code: _codeController.text,
      newPassword: _passwordController.text,
    );

    if (!mounted) return;
    setState(() => _submitting = false);

    if (!ok) {
      setState(() => _localError = auth.errorMessage);
      return;
    }

    messenger.showSnackBar(
      const SnackBar(content: Text('Password updated — sign in with your new password.')),
    );
    navigator.pushNamedAndRemoveUntil('/login', (_) => false);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();

    return AuthScaffold(
      title: 'Reset your password',
      subtitle: _codeSent
          ? 'Enter the code we sent and choose a new password'
          : 'We will send a reset code to your email or phone',
      children: [
        Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (_localError != null) AuthErrorBanner(message: _localError!),
              if (auth.errorMessage != null) AuthErrorBanner(message: auth.errorMessage!),

              TextFormField(
                controller: _identifierController,
                autofocus: true,
                enabled: !_codeSent,
                keyboardType: TextInputType.emailAddress,
                textInputAction: TextInputAction.next,
                decoration: InputDecoration(
                  labelText: 'Email or phone',
                  prefixIcon: const FaIcon(AppIcons.email),
                  suffixIcon: _codeSent
                      ? null
                      : TextButton(
                          onPressed: _sending ? null : _sendCode,
                          child: _sending
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Text('Send code'),
                        ),
                ),
                validator: AuthValidators.identifierError,
              ),

              if (_codeSent) ...[
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
                  ),
                  validator: (value) => AuthValidators.isVerificationCode(value ?? '')
                      ? null
                      : 'Enter the 6-digit code',
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _passwordController,
                  obscureText: _obscure,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: 'New password',
                    prefixIcon: const FaIcon(AppIcons.lock),
                    helperText: 'At least 6 characters',
                    suffixIcon: IconButton(
                      icon: FaIcon(_obscure ? AppIcons.visibilityOff : AppIcons.visibility),
                      onPressed: () => setState(() => _obscure = !_obscure),
                    ),
                  ),
                  validator: AuthValidators.passwordError,
                ),
                const SizedBox(height: 14),
                TextFormField(
                  controller: _confirmController,
                  obscureText: true,
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => _resetPassword(),
                  decoration: const InputDecoration(
                    labelText: 'Confirm new password',
                    prefixIcon: FaIcon(AppIcons.password),
                  ),
                  validator: (value) => AuthValidators.confirmPasswordError(
                    value,
                    _passwordController.text,
                  ),
                ),
              ],

              const SizedBox(height: 22),
              if (_codeSent)
                FilledButton(
                  onPressed: _submitting ? null : _resetPassword,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF008069),
                    minimumSize: const Size.fromHeight(50),
                  ),
                  child: _submitting
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: Colors.white,
                          ),
                        )
                      : const Text('Set new password', style: TextStyle(fontSize: 16)),
                ),
              const SizedBox(height: 10),
              Wrap(
                alignment: WrapAlignment.center,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  TextButton(
                    onPressed: () => Navigator.of(context).pushNamed('/login'),
                    child: const Text('Back to sign in'),
                  ),
                  if (_codeSent)
                    TextButton(
                      onPressed: _sending ? null : _sendCode,
                      child: const Text('Resend code'),
                    ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
