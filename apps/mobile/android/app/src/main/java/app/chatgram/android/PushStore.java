package app.chatgram.android;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Persists the FCM registration token.
 *
 * <p>{@code onNewToken} runs in {@link ChatgramMessagingService}, which can be
 * started even when the WebView is not running, so the token cannot live in
 * memory. {@code Notifier.getFcmToken()} reads it from here; the web layer
 * uploads it to the Chatgram server (the server side of push is out of this
 * module's scope).
 */
final class PushStore {

    private static final String FILE = "chatgram_push";
    private static final String KEY_TOKEN = "fcmToken";

    private PushStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static void setToken(Context context, String token) {
        if (token == null || token.isEmpty()) return;
        prefs(context).edit().putString(KEY_TOKEN, token).apply();
    }

    /** The last token seen by FCM, or "" when there is none yet. */
    static String token(Context context) {
        String token = prefs(context).getString(KEY_TOKEN, "");
        return token == null ? "" : token;
    }

    static void clearToken(Context context) {
        prefs(context).edit().remove(KEY_TOKEN).apply();
    }
}
