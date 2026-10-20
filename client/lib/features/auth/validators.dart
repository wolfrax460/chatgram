/// Shared validation for sign-up / sign-in identifiers and passwords.
///
/// Kept separate from the screens so the same rules can be unit tested and
/// reused (login, register, verification) without pulling in a widget.
class AuthValidators {
  AuthValidators._();

  static final RegExp _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');
  static final RegExp _phone = RegExp(r'^\+?[0-9]{7,15}$');
  static final RegExp _code = RegExp(r'^[0-9]{6}$');
  static final RegExp _formatting = RegExp(r'[\s\-().]');

  /// Is this a syntactically valid email address?
  static bool isEmail(String value) => _email.hasMatch(value.trim().toLowerCase());

  /// Is this a valid phone number (optional `+`, 7–15 digits)?
  ///
  /// Spaces, dashes, dots and brackets are ignored, so `(250) 780 000 001`
  /// and `+250780000001` are both accepted.
  static bool isPhone(String value) => _phone.hasMatch(normalizeIdentifier(value));

  /// Valid email **or** phone number.
  static bool isValidIdentifier(String value) {
    final text = value.trim();
    if (text.isEmpty) return false;
    return text.contains('@') ? isEmail(text) : isPhone(text);
  }

  /// Valid 6-digit verification code.
  static bool isVerificationCode(String value) => _code.hasMatch(value.trim());

  /// Lowercase emails; strip formatting characters from phone numbers.
  static String normalizeIdentifier(String value) {
    final trimmed = value.trim();
    if (trimmed.contains('@')) return trimmed.toLowerCase();
    return trimmed.replaceAll(_formatting, '');
  }

  /// Human-readable problem with [value], or null when it is fine.
  static String? identifierError(String? value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return 'Enter your email address or phone number';
    if (text.contains('@')) {
      return isEmail(text) ? null : 'Enter a valid email, e.g. name@example.com';
    }
    if (!isPhone(text)) {
      return 'Enter a valid phone number with country code, e.g. +250780000001';
    }
    return null;
  }

  static String? displayNameError(String? value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return 'Enter a display name';
    if (text.length < 2) return 'At least 2 characters';
    return null;
  }

  static String? passwordError(String? value) {
    final text = value ?? '';
    if (text.isEmpty) return 'Choose a password';
    if (text.length < 6) return 'At least 6 characters';
    return null;
  }

  /// Confirmation must match [password].
  static String? confirmPasswordError(String? value, String password) {
    if (value == null || value.isEmpty) return 'Re-enter your password';
    if (value != password) return 'Passwords do not match';
    return null;
  }
}
