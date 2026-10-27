package app.chatgram.android;

import android.content.Context;

import java.io.File;

/** Where the downloaded APK lives (app-specific external storage, FileProvider-shared). */
final class UpdatePaths {

    private UpdatePaths() {
    }

    static File directory(Context context) {
        File base = context.getExternalFilesDir(null);
        if (base == null) base = context.getFilesDir();
        File dir = new File(base, "updates");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    /** The file recorded in prefs, or the newest .apk in the directory. */
    static File downloadedFile(Context context) {
        String recorded = UpdatePrefs.filePath(context);
        if (recorded != null && !recorded.isEmpty()) {
            File file = new File(recorded);
            if (file.isFile()) return file;
        }
        File[] files = directory(context).listFiles((dir, name) -> name.endsWith(".apk"));
        if (files == null || files.length == 0) return null;
        File newest = files[0];
        for (File file : files) {
            if (file.lastModified() > newest.lastModified()) newest = file;
        }
        return newest;
    }

    /** Delete any previously downloaded APKs (called before a new download). */
    static void clearDownloads(Context context) {
        File[] files = directory(context).listFiles((dir, name) -> name.endsWith(".apk"));
        if (files == null) return;
        for (File file : files) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }
}
