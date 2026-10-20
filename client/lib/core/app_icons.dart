import 'package:font_awesome_flutter/font_awesome_flutter.dart';

/// Every icon the app uses, in one place.
///
/// The app used Material `Icons.*` scattered across 27 files. Centralising them
/// here means:
///   * one consistent icon language (FontAwesome) instead of a mix,
///   * a single file to touch when a glyph should change,
///   * no risk of a stray Material icon surviving a redesign.
///
/// Names are semantic (what the icon *means*), not literal (what it looks
/// like), so swapping the underlying glyph never touches call sites.
class AppIcons {
  const AppIcons._();

  // ------------------------------------------------------------------ brand
  static const FaIconData logo = FontAwesomeIcons.comment;
  static const FaIconData chat = FontAwesomeIcons.comment;
  static const FaIconData chatFilled = FontAwesomeIcons.commentDots;
  static const FaIconData chats = FontAwesomeIcons.comments;
  static const FaIconData status = FontAwesomeIcons.circleNotch;
  static const FaIconData group = FontAwesomeIcons.users;
  static const FaIconData groups = FontAwesomeIcons.users;
  static const FaIconData contact = FontAwesomeIcons.user;
  static const FaIconData contacts = FontAwesomeIcons.users;
  static const FaIconData settings = FontAwesomeIcons.gear;

  // ------------------------------------------------------------------- auth
  static const FaIconData person = FontAwesomeIcons.user;
  static const FaIconData personAdd = FontAwesomeIcons.userPlus;
  static const FaIconData personBlocked = FontAwesomeIcons.userSlash;
  static const FaIconData email = FontAwesomeIcons.at;
  static const FaIconData phone = FontAwesomeIcons.phone;
  static const FaIconData password = FontAwesomeIcons.key;
  static const FaIconData lock = FontAwesomeIcons.lock;
  static const FaIconData logout = FontAwesomeIcons.rightFromBracket;
  static const FaIconData visibility = FontAwesomeIcons.eye;
  static const FaIconData visibilityOff = FontAwesomeIcons.eyeSlash;
  static const FaIconData verified = FontAwesomeIcons.circleCheck;
  static const FaIconData info = FontAwesomeIcons.circleInfo;
  static const FaIconData error = FontAwesomeIcons.circleExclamation;
  static const FaIconData warning = FontAwesomeIcons.triangleExclamation;

  // ------------------------------------------------------------------- chat
  static const FaIconData send = FontAwesomeIcons.paperPlane;
  static const FaIconData attach = FontAwesomeIcons.paperclip;
  static const FaIconData camera = FontAwesomeIcons.camera;
  static const FaIconData mic = FontAwesomeIcons.microphone;
  static const FaIconData photo = FontAwesomeIcons.image;
  static const FaIconData video = FontAwesomeIcons.video;
  static const FaIconData videoOff = FontAwesomeIcons.videoSlash;
  static const FaIconData file = FontAwesomeIcons.file;
  static const FaIconData volume = FontAwesomeIcons.volumeHigh;
  static const FaIconData play = FontAwesomeIcons.circlePlay;
  static const FaIconData pause = FontAwesomeIcons.circlePause;
  static const FaIconData replay = FontAwesomeIcons.rotateLeft;
  static const FaIconData forward = FontAwesomeIcons.forward;
  static const FaIconData clock = FontAwesomeIcons.clock;
  static const FaIconData delivered = FontAwesomeIcons.check;
  static const FaIconData read = FontAwesomeIcons.checkDouble;

  // ---------------------------------------------------------------- actions
  static const FaIconData add = FontAwesomeIcons.circlePlus;
  static const FaIconData close = FontAwesomeIcons.xmark;
  static const FaIconData clear = FontAwesomeIcons.xmark;
  static const FaIconData check = FontAwesomeIcons.check;
  static const FaIconData search = FontAwesomeIcons.magnifyingGlass;
  static const FaIconData searchOff = FontAwesomeIcons.magnifyingGlass;
  static const FaIconData refresh = FontAwesomeIcons.arrowsRotate;
  static const FaIconData download = FontAwesomeIcons.download;
  static const FaIconData update = FontAwesomeIcons.arrowsRotate;
  static const FaIconData edit = FontAwesomeIcons.penToSquare;
  static const FaIconData delete = FontAwesomeIcons.trash;
  static const FaIconData link = FontAwesomeIcons.link;
  static const FaIconData openExternal = FontAwesomeIcons.arrowUpRightFromSquare;

  // -------------------------------------------------------------- navigation
  static const FaIconData back = FontAwesomeIcons.arrowLeft;
  static const FaIconData next = FontAwesomeIcons.arrowRight;
  static const FaIconData chevronLeft = FontAwesomeIcons.chevronLeft;
  static const FaIconData chevronRight = FontAwesomeIcons.chevronRight;
  static const FaIconData selected = FontAwesomeIcons.circleDot;
  static const FaIconData unselected = FontAwesomeIcons.circle;

  // ------------------------------------------------------------- platforms
  static const FaIconData android = FontAwesomeIcons.android;
  static const FaIconData windows = FontAwesomeIcons.desktop;
  static const FaIconData laptop = FontAwesomeIcons.laptop;
  static const FaIconData mobile = FontAwesomeIcons.mobileScreenButton;
  static const FaIconData globe = FontAwesomeIcons.globe;
  static const FaIconData server = FontAwesomeIcons.server;
  static const FaIconData cloudOff = FontAwesomeIcons.cloud;
  static const FaIconData bell = FontAwesomeIcons.bell;
  static const FaIconData theme = FontAwesomeIcons.circleHalfStroke;
  static const FaIconData sun = FontAwesomeIcons.sun;
  static const FaIconData moon = FontAwesomeIcons.moon;
  static const FaIconData badge = FontAwesomeIcons.idBadge;
  static const FaIconData location = FontAwesomeIcons.locationDot;

  // ------------------------------------------------------------------ media
  static const FaIconData brokenImage = FontAwesomeIcons.image;
  static const FaIconData statusRing = FontAwesomeIcons.circleNotch;
  static const FaIconData avatarDefault = FontAwesomeIcons.user;
}
