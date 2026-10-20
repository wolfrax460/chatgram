import 'package:flutter/material.dart';

import '../models/message_model.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// WhatsApp-style delivery ticks.
class MessageTicks extends StatelessWidget {
  const MessageTicks({super.key, required this.status, this.size = 15});

  final MessageStatus status;
  final double size;

  static const Color _read = Color(0xFF53BDEB);
  static const Color _muted = Color(0xFF8696A0);

  @override
  Widget build(BuildContext context) {
    switch (status) {
      case MessageStatus.failed:
        return FaIcon(AppIcons.error, size: size, color: Colors.redAccent);
      case MessageStatus.sending:
        return FaIcon(AppIcons.clock, size: size, color: _muted);
      case MessageStatus.sent:
        return FaIcon(AppIcons.check, size: size, color: _muted);
      case MessageStatus.delivered:
        return FaIcon(AppIcons.read, size: size, color: _muted);
      case MessageStatus.read:
        return FaIcon(AppIcons.read, size: size, color: _read);
    }
  }

  static String describe(MessageStatus status) {
    switch (status) {
      case MessageStatus.failed:
        return 'Not sent';
      case MessageStatus.sending:
        return 'Sending';
      case MessageStatus.sent:
        return 'Sent';
      case MessageStatus.delivered:
        return 'Delivered';
      case MessageStatus.read:
        return 'Read';
    }
  }
}
