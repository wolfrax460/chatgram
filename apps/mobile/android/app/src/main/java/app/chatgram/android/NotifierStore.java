package app.chatgram.android;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/**
 * The hand-off point between a notification tap and the web layer.
 *
 * <p>A tap arrives on the main thread (or creates the process), while
 * {@code Notifier.consumePending()} is called later by the WebView's
 * JavaScript. SharedPreferences is the only place both sides can meet, and it
 * also survives the process being recreated between the tap and the JS read.
 *
 * <p>The pending chat is "last tap wins": tapping chat A then chat B before the
 * web layer polls leaves B. Consuming it clears it, so a chat is never opened
 * twice for one tap.
 */
final class NotifierStore {

    /** Intent extra carrying the chat id of a tapped message notification. */
    static final String EXTRA_CHAT_ID = "app.chatgram.android.extra.NOTIFICATION_CHAT_ID";
    /** Intent extra carrying the notification tag (diagnostics only). */
    static final String EXTRA_TAG = "app.chatgram.android.extra.NOTIFICATION_TAG";
    /** Intent extra carrying the notification id (diagnostics only). */
    static final String EXTRA_ID = "app.chatgram.android.extra.NOTIFICATION_ID";
    /**
     * Unique value per POSTED notification. Android replays the launch intent
     * when the activity is recreated (rotation or process restore), which would
     * otherwise re-open an already consumed chat; this token is compared with
     * the last handled one and the replay is ignored.
     */
    static final String EXTRA_TAP_ID = "app.chatgram.android.extra.NOTIFICATION_TAP_ID";

    private static final String FILE = "chatgram_notifier";
    private static final String KEY_PENDING_CHAT = "pendingChatId";
    private static final String KEY_LAST_TAP = "lastTapId";
    private static final Object LOCK = new Object();

    private NotifierStore() {
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    /**
     * Records the chat id carried by a notification tap.
     *
     * <p>The extras are REMOVED from the intent after reading. Android reuses the
     * launch intent when the activity is recreated (rotation, process restore)
     * and {@code BridgeActivity.load()} replays it through onNewIntent(); without
     * this, an already-opened chat would be opened again on every recreation.
     *
     * <p>{@code commit()} is used on purpose: the WebView may call
     * {@code consumePending()} a few milliseconds later, and an async
     * {@code apply()} could still be in flight.
     */
    static void captureFromIntent(Context context, Intent intent) {
        if (intent == null) return;

        String tapId = intent.getStringExtra(EXTRA_TAP_ID);
        if (tapId != null && !tapId.isEmpty()) {
            String chatId = intent.getStringExtra(EXTRA_CHAT_ID);
            synchronized (LOCK) {
                SharedPreferences prefs = prefs(context);
                // Only a tap that has not been handled yet may change the pending
                // chat; a replayed launch intent carries the same token.
                if (!tapId.equals(prefs.getString(KEY_LAST_TAP, null))) {
                    SharedPreferences.Editor editor = prefs.edit().putString(KEY_LAST_TAP, tapId);
                    if (chatId != null && !chatId.isEmpty()) {
                        editor.putString(KEY_PENDING_CHAT, chatId);
                    }
                    editor.commit();
                }
            }
        }

        intent.removeExtra(EXTRA_CHAT_ID);
        intent.removeExtra(EXTRA_TAG);
        intent.removeExtra(EXTRA_ID);
        intent.removeExtra(EXTRA_TAP_ID);
    }

    /** Returns the chat id of the last notification tap and clears it atomically. */
    static String consumePendingChatId(Context context) {
        synchronized (LOCK) {
            SharedPreferences prefs = prefs(context);
            String chatId = prefs.getString(KEY_PENDING_CHAT, null);
            if (chatId == null) return null;
            prefs.edit().remove(KEY_PENDING_CHAT).commit();
            return chatId.isEmpty() ? null : chatId;
        }
    }
}
