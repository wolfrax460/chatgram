import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// Circular avatar with an initials fallback and an optional presence dot.
class UserAvatar extends StatelessWidget {
  const UserAvatar({
    super.key,
    this.imageUrl,
    required this.initials,
    this.size = 48,
    this.isOnline = false,
    this.showPresence = false,
    this.colorSeed,
  });

  final String? imageUrl;
  final String initials;
  final double size;
  final bool isOnline;
  final bool showPresence;
  final String? colorSeed;

  @override
  Widget build(BuildContext context) {
    final url = (imageUrl ?? '').trim();
    final hasImage = url.isNotEmpty;

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          ClipOval(
            child: SizedBox(
              width: size,
              height: size,
              child: hasImage
                  ? CachedNetworkImage(
                      imageUrl: url,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => _fallback(context),
                      errorWidget: (_, __, ___) => _fallback(context),
                    )
                  : _fallback(context),
            ),
          ),
          if (showPresence)
            Positioned(
              right: 0,
              bottom: 0,
              child: Container(
                width: size * 0.28,
                height: size * 0.28,
                decoration: BoxDecoration(
                  color: isOnline ? AppColors.online : Colors.grey,
                  shape: BoxShape.circle,
                  border: Border.all(
                    color: Theme.of(context).scaffoldBackgroundColor,
                    width: 2,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _fallback(BuildContext context) {
    final palette = [
      const Color(0xFF00897B),
      const Color(0xFF5E35B1),
      const Color(0xFFD81B60),
      const Color(0xFF1E88E5),
      const Color(0xFFF4511E),
      const Color(0xFF6D4C41),
      const Color(0xFF3949AB),
      const Color(0xFF00838F),
    ];
    final seed = (colorSeed ?? initials);
    final color = palette[seed.hashCode.abs() % palette.length];

    return Container(
      color: color,
      alignment: Alignment.center,
      child: Text(
        initials.isEmpty ? '?' : initials,
        style: TextStyle(
          color: Colors.white,
          fontSize: size * 0.38,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
