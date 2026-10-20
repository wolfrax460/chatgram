import 'package:http/http.dart' as http;

/// Web: the recorder produced a `blob:` URL. Fetching a blob URL from the page
/// works, so read the bytes back through the normal HTTP stack.
Future<List<int>> readMediaBytes(String path) async {
  final response = await http.get(Uri.parse(path));
  if (response.statusCode != 200) {
    throw StateError('Could not read the recording (status ${response.statusCode})');
  }
  return response.bodyBytes;
}
