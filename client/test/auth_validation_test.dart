import 'package:chatgram/features/auth/validators.dart';
import 'package:chatgram/shared/models/status_model.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('AuthValidators identifiers', () {
    test('accepts valid email addresses', () {
      expect(AuthValidators.isEmail('alice@example.com'), isTrue);
      expect(AuthValidators.isEmail('a.b+tag@sub.example.co.uk'), isTrue);
      expect(AuthValidators.isEmail('ALICE@EXAMPLE.COM'), isTrue);
    });

    test('rejects malformed email addresses', () {
      expect(AuthValidators.isEmail('alice'), isFalse);
      expect(AuthValidators.isEmail('alice@'), isFalse);
      expect(AuthValidators.isEmail('alice@example'), isFalse);
      expect(AuthValidators.isEmail('alice@example.c'), isFalse);
      expect(AuthValidators.isEmail('@example.com'), isFalse);
      expect(AuthValidators.isEmail('a b@example.com'), isFalse);
    });

    test('accepts phone numbers with a country code', () {
      expect(AuthValidators.isPhone('+250780000001'), isTrue);
      expect(AuthValidators.isPhone('0780000001'), isTrue);
      expect(AuthValidators.isPhone('+1 555 010 9999'), isTrue);
      expect(AuthValidators.isPhone('+250-780-000-001'), isTrue);
      expect(AuthValidators.isPhone('(250) 780 000 001'), isTrue);
    });

    test('rejects phone numbers that are too short or contain letters', () {
      expect(AuthValidators.isPhone('12345'), isFalse);
      expect(AuthValidators.isPhone('+25078000000123456'), isFalse);
      expect(AuthValidators.isPhone('call-me'), isFalse);
      expect(AuthValidators.isPhone(''), isFalse);
    });

    test('normalizes phone formatting but leaves emails lowercased', () {
      expect(AuthValidators.normalizeIdentifier('+250 780 000 001'), '+250780000001');
      expect(AuthValidators.normalizeIdentifier('(250)-780.000.001'), '250780000001');
      expect(AuthValidators.normalizeIdentifier('  Alice@Example.COM '), 'alice@example.com');
    });

    test('isValidIdentifier accepts either form', () {
      expect(AuthValidators.isValidIdentifier('alice@example.com'), isTrue);
      expect(AuthValidators.isValidIdentifier('+250780000001'), isTrue);
      expect(AuthValidators.isValidIdentifier('nonsense'), isFalse);
      expect(AuthValidators.isValidIdentifier(''), isFalse);
    });

    test('identifierError returns a helpful message', () {
      expect(AuthValidators.identifierError(''), isNotNull);
      expect(AuthValidators.identifierError('bad@'), contains('valid email'));
      expect(AuthValidators.identifierError('123'), contains('phone number'));
      expect(AuthValidators.identifierError('alice@example.com'), isNull);
    });

    test('verification codes must be exactly six digits', () {
      expect(AuthValidators.isVerificationCode('123456'), isTrue);
      expect(AuthValidators.isVerificationCode('12345'), isFalse);
      expect(AuthValidators.isVerificationCode('1234567'), isFalse);
      expect(AuthValidators.isVerificationCode('12a456'), isFalse);
    });
  });

  group('AuthValidators passwords', () {
    test('enforces a 6 character minimum', () {
      expect(AuthValidators.passwordError(''), isNotNull);
      expect(AuthValidators.passwordError('12345'), isNotNull);
      expect(AuthValidators.passwordError('123456'), isNull);
    });

    test('confirmation must match exactly', () {
      expect(AuthValidators.confirmPasswordError('', 'secret123'), isNotNull);
      expect(AuthValidators.confirmPasswordError('secret124', 'secret123'),
          'Passwords do not match');
      expect(AuthValidators.confirmPasswordError('secret123', 'secret123'), isNull);
    });

    test('display name must be at least two characters', () {
      expect(AuthValidators.displayNameError(''), isNotNull);
      expect(AuthValidators.displayNameError('X'), isNotNull);
      expect(AuthValidators.displayNameError('Jo'), isNull);
    });
  });

  group('StatusModel viewers', () {
    test('parses populated viewers with names', () {
      final status = StatusModel.fromJson({
        '_id': 's1',
        'userId': {'_id': 'u1', 'displayName': 'Alice'},
        'text': 'hello',
        'createdAt': '2026-01-01T10:00:00.000Z',
        'viewedBy': [
          {'_id': 'u2', 'displayName': 'Bob Smith', 'avatarUrl': '/uploads/avatars/b.png'},
        ],
      });

      expect(status.viewers, hasLength(1));
      expect(status.viewers.first.displayName, 'Bob Smith');
      expect(status.viewers.first.initials, 'BS');
      expect(status.viewedBy, ['u2']);
      expect(status.isViewedBy('u2'), isTrue);
      expect(status.isViewedBy('u3'), isFalse);
    });

    test('handles the legacy id-only viewer payload without inventing names', () {
      final status = StatusModel.fromJson({
        '_id': 's2',
        'userId': 'u1',
        'text': 'legacy',
        'createdAt': '2026-01-01T10:00:00.000Z',
        'viewedBy': ['u2', 'u3'],
      });

      expect(status.viewedBy, ['u2', 'u3']);
      // No names available, so the named list stays empty rather than showing
      // blank rows in the UI.
      expect(status.viewers, isEmpty);
    });

    test('handles a status with no viewers', () {
      final status = StatusModel.fromJson({
        '_id': 's3',
        'userId': {'_id': 'u1', 'displayName': 'Alice'},
        'text': 'nobody yet',
        'createdAt': '2026-01-01T10:00:00.000Z',
      });

      expect(status.viewedBy, isEmpty);
      expect(status.viewers, isEmpty);
      expect(status.displayName, 'Alice');
    });

    test('remaining time shrinks and never goes negative', () {
      final fresh = StatusModel.fromJson({
        '_id': 's4',
        'userId': 'u1',
        'text': 'x',
        'createdAt': DateTime.now().toUtc().toIso8601String(),
      });
      // Just under 24 hours, so slightly more than 23h remain.
      expect(fresh.remaining, greaterThan(const Duration(hours: 23)));
      expect(fresh.remaining, lessThanOrEqualTo(const Duration(hours: 24)));

      final old = StatusModel.fromJson({
        '_id': 's5',
        'userId': 'u1',
        'text': 'x',
        'createdAt': DateTime.now()
            .subtract(const Duration(days: 2))
            .toUtc()
            .toIso8601String(),
      });
      expect(old.remaining, Duration.zero);
    });
  });
}
