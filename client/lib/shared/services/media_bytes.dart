/// Reads bytes from a path returned by the recorder.
///
/// On native platforms `record` returns a real file path; on web it returns a
/// `blob:` URL. The two implementations live in separate files so `dart:io`
/// never reaches the web build.
export 'media_bytes_io.dart' if (dart.library.js_interop) 'media_bytes_web.dart';
