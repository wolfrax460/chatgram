import 'dart:io';

/// Native: the recorder wrote a real file, so read it from disk.
Future<List<int>> readMediaBytes(String path) async {
  final file = File(path);
  if (!await file.exists()) {
    throw StateError('Recording file not found at $path');
  }
  return file.readAsBytes();
}
