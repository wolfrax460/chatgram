package app.chatgram.android;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;

import org.json.JSONObject;

/**
 * Update state persisted in SharedPreferences.
 *
 * The web layer and the DownloadManager receiver are different processes of
 * truth at different times (the app may be closed when a download finishes), so
 * every piece of the update state lives here instead of in memory.
 *
 * Network preference: {@code wifiOnly} defaults to false, i.e. the update may be
 * downloaded over Wi-Fi OR mobile data — whichever is available. Users who want
 * to save data can turn it on.
 */
final class UpdatePrefs {

    private static final String FILE = "chatgram_updates";

    private static final String KEY_STATE = "state";           // idle|checking|available|downloading|ready|error|required
    private static final String KEY_VERSION = "version";
    private static final String KEY_CODE = "versionCode";
    private static final String KEY_URL = "url";
    private static final String KEY_SHA256 = "sha256";
    private static final String KEY_SIZE = "size";
    private static final String KEY_NOTES = "notes";
    private static final String KEY_FORCE = "force";
    private static final String KEY_REQUIRED = "required";
    private static final String KEY_REQUEST_ID = "requestId";
    private static final String KEY_FILE = "file";
    private static final String KEY_ERROR = "error";
    private static final String KEY_LAST_CHECK = "lastCheckedAt";
    private static final String KEY_WIFI_ONLY = "wifiOnly";
    private static final String KEY_DOWNLOADED = "downloaded";
    private static final String KEY_TOTAL = "total";

    private UpdatePrefs() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /** True when downloads are limited to Wi-Fi (off by default: either network works). */
    static boolean isWifiOnly(Context context) {
        return prefs(context).getBoolean(KEY_WIFI_ONLY, false);
    }

    static void setWifiOnly(Context context, boolean value) {
        prefs(context).edit().putBoolean(KEY_WIFI_ONLY, value).apply();
    }

    static void setState(Context context, String state) {
        prefs(context).edit().putString(KEY_STATE, state).apply();
    }

    static void setError(Context context, String message) {
        prefs(context).edit().putString(KEY_ERROR, message == null ? "" : message).putString(KEY_STATE, "error").apply();
    }

    static void setChecked(Context context) {
        prefs(context).edit().putLong(KEY_LAST_CHECK, System.currentTimeMillis()).apply();
    }

    static long lastCheckedAt(Context context) {
        return prefs(context).getLong(KEY_LAST_CHECK, 0L);
    }

    static String state(Context context) {
        return prefs(context).getString(KEY_STATE, "idle");
    }

    static void setAvailable(Context context, VersionClient.Info info, boolean required) {
        // A check that runs while the download is in flight (or finished) must not
        // pull the state back to "available" — that is what hid the ready state
        // during the emulator test.
        String current = state(context);
        String currentVersion = version(context);
        if (("downloading".equals(current) || "ready".equals(current)) && info.latestVersion.equals(currentVersion)) {
            prefs(context).edit()
                    .putString(KEY_NOTES, info.notes)
                    .putBoolean(KEY_REQUIRED, required || prefs(context).getBoolean(KEY_REQUIRED, false))
                    .apply();
            return;
        }
        prefs(context).edit()
                .putString(KEY_VERSION, info.latestVersion)
                .putInt(KEY_CODE, info.versionCode)
                .putString(KEY_URL, info.url)
                .putString(KEY_SHA256, info.sha256)
                .putLong(KEY_SIZE, info.size)
                .putString(KEY_NOTES, info.notes)
                .putBoolean(KEY_FORCE, info.forceUpdate)
                .putBoolean(KEY_REQUIRED, required)
                .putString(KEY_ERROR, "")
                .putString(KEY_STATE, required ? "required" : "available")
                .apply();
    }

    static void setDownloading(Context context, long requestId, String filePath) {
        prefs(context).edit()
                .putLong(KEY_REQUEST_ID, requestId)
                .putString(KEY_FILE, filePath == null ? "" : filePath)
                .putString(KEY_STATE, "downloading")
                .putString(KEY_ERROR, "")
                .apply();
    }

    static void setReady(Context context, String filePath, long bytes) {
        prefs(context).edit()
                .putString(KEY_FILE, filePath == null ? "" : filePath)
                .putString(KEY_STATE, "ready")
                .putString(KEY_ERROR, "")
                .putLong(KEY_DOWNLOADED, bytes)
                .apply();
    }

    static void setProgress(Context context, long downloaded, long total) {
        prefs(context).edit().putLong(KEY_DOWNLOADED, downloaded).putLong(KEY_TOTAL, total).apply();
    }

    static void clearReady(Context context) {
        prefs(context).edit()
                .putString(KEY_STATE, "idle")
                .remove(KEY_REQUEST_ID)
                .putString(KEY_ERROR, "")
                .apply();
    }

    static long requestId(Context context) {
        return prefs(context).getLong(KEY_REQUEST_ID, -1L);
    }

    static String filePath(Context context) {
        return prefs(context).getString(KEY_FILE, "");
    }

    static String expectedSha256(Context context) {
        return prefs(context).getString(KEY_SHA256, "");
    }

    /** The download URL recorded by the last successful check (already validated). */
    static String url(Context context) {
        return prefs(context).getString(KEY_URL, "");
    }

    static String version(Context context) {
        return prefs(context).getString(KEY_VERSION, "");
    }

    static boolean isRequired(Context context) {
        return prefs(context).getBoolean(KEY_REQUIRED, false);
    }

    /** Everything the web UI needs, as the same shape the desktop updater uses. */
    static JSObject toJson(Context context) {
        SharedPreferences prefs = prefs(context);
        JSObject json = new JSObject();
        try {
            String state = prefs.getString(KEY_STATE, "idle");
            json.put("status", state);
            json.put("required", prefs.getBoolean(KEY_REQUIRED, false));
            json.put("forceUpdate", prefs.getBoolean(KEY_FORCE, false));
            json.put("version", prefs.getString(KEY_VERSION, ""));
            json.put("versionCode", prefs.getInt(KEY_CODE, 0));
            json.put("notes", prefs.getString(KEY_NOTES, ""));
            json.put("size", prefs.getLong(KEY_SIZE, 0));
            json.put("downloaded", prefs.getLong(KEY_DOWNLOADED, 0));
            json.put("total", prefs.getLong(KEY_TOTAL, 0));
            json.put("error", prefs.getString(KEY_ERROR, ""));
            long last = prefs.getLong(KEY_LAST_CHECK, 0L);
            json.put("lastCheckedAt", last > 0 ? last : JSONObject.NULL);
            json.put("wifiOnly", prefs.getBoolean(KEY_WIFI_ONLY, false));
            json.put("file", prefs.getString(KEY_FILE, ""));
        } catch (Exception ignored) {
            // JSONObject.put only fails for NaN/infinite numbers, which cannot occur here.
        }
        return json;
    }
}
