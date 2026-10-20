import 'package:flutter/material.dart';

import '../../../server_config.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Lets the user point the app at a specific backend.
///
/// Essential for a **physical Android phone**: the emulator can use the
/// `10.0.2.2` alias, but a real device has to be told the PC's LAN address.
Future<void> showServerSettingsDialog(BuildContext context) {
  return showDialog<void>(
    context: context,
    builder: (_) => const _ServerSettingsDialog(),
  );
}

class _ServerSettingsDialog extends StatefulWidget {
  const _ServerSettingsDialog();

  @override
  State<_ServerSettingsDialog> createState() => _ServerSettingsDialogState();
}

class _ServerSettingsDialogState extends State<_ServerSettingsDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: ServerConfig.apiBaseUrl);

  bool _busy = false;
  String? _message;
  bool _ok = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _testAndSave() async {
    setState(() {
      _busy = true;
      _message = null;
    });

    final reachable = await ServerConfig.isReachable(_controller.text);
    if (!mounted) return;

    if (!reachable) {
      setState(() {
        _busy = false;
        _ok = false;
        _message =
            'No Chatgram API answered there.\n\nCheck that the backend is running '
            'and that you used your computer\'s LAN address (for example '
            '192.168.1.10:5001). Both devices must be on the same Wi-Fi.';
      });
      return;
    }

    final saved = await ServerConfig.saveServer(_controller.text);
    if (!mounted) return;

    setState(() {
      _busy = false;
      _ok = saved;
      _message = saved
          ? 'Connected to ${ServerConfig.apiBaseUrl}'
          : 'That address could not be saved.';
    });

    if (saved) {
      await Future<void>.delayed(const Duration(milliseconds: 900));
      if (mounted) Navigator.of(context).pop();
    }
  }

  Future<void> _useAutomatic() async {
    await ServerConfig.saveServer(null);
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AlertDialog(
      title: const Row(
        children: [
          FaIcon(AppIcons.server, size: 22),
          SizedBox(width: 10),
          Text('Server settings'),
        ],
      ),
      content: SizedBox(
        width: 380,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Point Chatgram at the computer running the backend.',
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Server address',
                hintText: '192.168.1.10:5001',
                prefixIcon: FaIcon(AppIcons.link),
                helperText: 'Port 5001 is assumed if you leave it out',
              ),
            ),
            if (_message != null) ...[
              const SizedBox(height: 14),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: _ok
                      ? const Color(0xFF25D366).withValues(alpha: 0.15)
                      : theme.colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  _message!,
                  style: TextStyle(
                    fontSize: 13,
                    color: _ok ? const Color(0xFF128C7E) : theme.colorScheme.onErrorContainer,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 14),
            Text(
              'Tip: run the backend with  npm start  and use the "Share this" '
              'address it prints.',
              style: theme.textTheme.bodySmall,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : _useAutomatic,
          child: const Text('Automatic'),
        ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : _testAndSave,
          child: _busy
              ? const SizedBox(
                  width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Test & save'),
        ),
      ],
    );
  }
}
