import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../features/auth/services/auth_service.dart';
import '../../features/settings/screens/server_settings_dialog.dart';
import '../../server_config.dart';
import 'package:chatgram/core/app_icons.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// A thin red strip shown above the whole app when the backend cannot be
/// reached.
///
/// Before this existed, pointing the app at a dead address (a stale LAN IP, or
/// the emulator-only `10.0.2.2` default on a physical phone) looked like the
/// app was simply frozen: every screen spun and every action failed with no
/// explanation.
class ServerStatusBanner extends StatelessWidget {
  const ServerStatusBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthService>();
    if (!auth.serverUnreachable) return const SizedBox.shrink();

    return Material(
      color: Theme.of(context).colorScheme.error,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 6, 4, 6),
          child: Row(
            children: [
              const FaIcon(AppIcons.cloudOff, color: Colors.white, size: 18),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Cannot reach the server\n$apiBaseUrl',
                  style: const TextStyle(color: Colors.white, fontSize: 12.5, height: 1.3),
                ),
              ),
              TextButton(
                onPressed: () => showServerSettingsDialog(context),
                style: TextButton.styleFrom(
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                  minimumSize: const Size(0, 32),
                ),
                child: const Text('Change server'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Small helper so any screen can offer the same fix.
Future<void> promptForServer(BuildContext context) async {
  final auth = context.read<AuthService>();
  await showServerSettingsDialog(context);
  // Re-check immediately so the banner clears when the address is fixed.
  await auth.loadServerConfig();
  await auth.retryReachability();
}
