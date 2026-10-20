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
  static const FaIconData logo = FontAwesomeIcons.solidComment;
  static const FaIconData chat = FontAwesomeIcons.solidComment;
  static const FaIconData chatFilled = FontAwesomeIcons.solidCommentDots;
  static const FaIconData chats = FontAwesomeIcons.solidComments;
  static const FaIconData status = FontAwesomeIcons.circleNotch;
  static const FaIconData group = FontAwesomeIcons.users;
  static const FaIconData groups = FontAwesomeIcons.users;
  static const FaIconData contact = FontAwesomeIcons.solidUser;
  static const FaIconData contacts = FontAwesomeIcons.users;
  static const FaIconData settings = FontAwesomeIcons.gear;

  // ------------------------------------------------------------------- auth
  static const FaIconData person = FontAwesomeIcons.solidUser;
  static const FaIconData personAdd = FontAwesomeIcons.userPlus;
  static const FaIconData personBlocked = FontAwesomeIcons.userSlash;
  static const FaIconData email = FontAwesomeIcons.at;
  static const FaIconData phone = FontAwesomeIcons.phone;
  static const FaIconData password = FontAwesomeIcons.key;
  static const FaIconData lock = FontAwesomeIcons.lock;
  static const FaIconData logout = FontAwesomeIcons.rightFromBracket;
  static const FaIconData visibility = FontAwesomeIcons.solidEye;
  static const FaIconData visibilityOff = FontAwesomeIcons.solidEyeSlash;
  static const FaIconData verified = FontAwesomeIcons.solidCircleCheck;
  static const FaIconData info = FontAwesomeIcons.circleInfo;
  static const FaIconData error = FontAwesomeIcons.circleExclamation;
  static const FaIconData warning = FontAwesomeIcons.triangleExclamation;

  // ------------------------------------------------------------------- chat
  static const FaIconData send = FontAwesomeIcons.solidPaperPlane;
  static const FaIconData attach = FontAwesomeIcons.paperclip;
  static const FaIconData camera = FontAwesomeIcons.solidCamera;
  static const FaIconData mic = FontAwesomeIcons.microphone;
  static const FaIconData photo = FontAwesomeIcons.solidImage;
  static const FaIconData video = FontAwesomeIcons.video;
  static const FaIconData videoOff = FontAwesomeIcons.videoSlash;
  static const FaIconData file = FontAwesomeIcons.solidFile;
  static const FaIconData volume = FontAwesomeIcons.volumeHigh;
  static const FaIconData play = FontAwesomeIcons.solidCirclePlay;
  static const FaIconData pause = FontAwesomeIcons.solidCirclePause;
  static const FaIconData replay = FontAwesomeIcons.rotateLeft;
  static const FaIconData forward = FontAwesomeIcons.forward;
  static const FaIconData clock = FontAwesomeIcons.solidClock;
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
  static const FaIconData edit = FontAwesomeIcons.solidPenToSquare;
  static const FaIconData delete = FontAwesomeIcons.trash;
  static const FaIconData link = FontAwesomeIcons.link;
  static const FaIconData openExternal = FontAwesomeIcons.arrowUpRightFromSquare;

  // -------------------------------------------------------------- navigation
  static const FaIconData back = FontAwesomeIcons.arrowLeft;
  static const FaIconData next = FontAwesomeIcons.arrowRight;
  static const FaIconData chevronLeft = FontAwesomeIcons.chevronLeft;
  static const FaIconData chevronRight = FontAwesomeIcons.chevronRight;
  static const FaIconData selected = FontAwesomeIcons.solidCircleDot;
  static const FaIconData unselected = FontAwesomeIcons.solidCircle;

  // ------------------------------------------------------------- platforms
  static const FaIconData android = FontAwesomeIcons.android;
  static const FaIconData windows = FontAwesomeIcons.desktop;
  static const FaIconData laptop = FontAwesomeIcons.laptop;
  static const FaIconData mobile = FontAwesomeIcons.mobileScreenButton;
  static const FaIconData globe = FontAwesomeIcons.globe;
  static const FaIconData server = FontAwesomeIcons.server;
  static const FaIconData cloudOff = FontAwesomeIcons.solidCloud;
  static const FaIconData bell = FontAwesomeIcons.solidBell;
  static const FaIconData theme = FontAwesomeIcons.palette;
  static const FaIconData sun = FontAwesomeIcons.solidSun;
  static const FaIconData moon = FontAwesomeIcons.solidMoon;
  static const FaIconData badge = FontAwesomeIcons.solidIdBadge;
  static const FaIconData location = FontAwesomeIcons.locationDot;

  // ------------------------------------------------------------------ media
  static const FaIconData brokenImage = FontAwesomeIcons.solidImage;
  static const FaIconData statusRing = FontAwesomeIcons.circleNotch;
  static const FaIconData avatarDefault = FontAwesomeIcons.solidUser;
}
