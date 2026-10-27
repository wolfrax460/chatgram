package app.chatgram.android;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * Incoming-call alerts for FCM {@code type=call} pushes.
 *
 * <p>Builds a high-priority notification on the {@code calls} channel with
 * Accept/Decline actions, asks for a full-screen intent when Android 14+ allows
 * it (otherwise the same notification is a heads-up alert), and rings the
 * default ringtone on a loop for at most 45 seconds. Accept opens
 * {@code MainActivity} with the {@code ?call=<callId>} deep link; Decline (a
 * broadcast to {@link CallActionReceiver}) stops the sound and removes the
 * notification without opening the app. {@code type=call_cancel} does the same
 * for a specific call.
 */
final class CallAlerts {

    static final String ACTION_DECLINE_CALL = "app.chatgram.android.action.DECLINE_CALL";
    static final String EXTRA_CALL_ID = "app.chatgram.android.extra.CALL_ID";
    static final String EXTRA_NOTIFICATION_TAG = "app.chatgram.android.extra.CALL_NOTIFICATION_TAG";
    static final String EXTRA_NOTIFICATION_ID = "app.chatgram.android.extra.CALL_NOTIFICATION_ID";

    private static final String TAG_PREFIX = "call:";
    private static final String FALLBACK_APP_URL = "https://chatgram-xi.vercel.app/web/";
    private static final long RING_TIMEOUT_MS = 45_000L;
    private static final int AVATAR_MAX_BYTES = 2 * 1024 * 1024;
    private static final int AVATAR_TIMEOUT_MS = 5_000;

    private static final Object LOCK = new Object();
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());

    private static MediaPlayer ringtone;
    private static Context appContext;
    private static String activeTag;
    private static int activeId;

    /** Fires 45 s after the call started ringing, or is cancelled by Accept/Decline/call_cancel. */
    private static final Runnable STOP_RINGING = () -> {
        Context context;
        synchronized (LOCK) {
            context = appContext;
        }
        try {
            stopActive(context);
        } catch (Exception ignored) {
            // A missed call must not crash the app.
        }
    };

    private CallAlerts() {
    }

    /** Handles one {@code type=call} FCM data message. */
    static void showIncomingCall(Context context, Map<String, String> data) {
        if (context == null || data == null) return;
        Context app = context.getApplicationContext();

        String callId = firstNonEmpty(data.get("callId"), data.get("call_id"));
        if (callId == null) callId = "call-" + System.currentTimeMillis();
        String chatId = firstNonEmpty(data.get("chatId"), data.get("chat_id"));
        String callerName = firstNonEmpty(
                data.get("callerName"),
                data.get("caller_name"),
                data.get("name")
        );
        if (callerName == null) callerName = "Incoming call";
        String avatarUrl = firstNonEmpty(data.get("avatar"), data.get("avatarUrl"), data.get("avatar_url"));

        final String tag = TAG_PREFIX + callId;
        final int id = stableId(callId);

        final PendingIntent acceptIntent = buildAcceptIntent(app, callId, id);
        final PendingIntent declineIntent = buildDeclineIntent(app, callId, tag, id);

        // Only one call can be ringing at a time: clear a previous one first.
        String previousTag;
        int previousId;
        synchronized (LOCK) {
            previousTag = activeTag;
            previousId = activeId;
            appContext = app;
            activeTag = tag;
            activeId = id;
        }
        if (previousTag != null && !previousTag.equals(tag)) {
            cancelNotification(app, previousTag, previousId);
        }

        postNotification(app, tag, id, buildNotification(app, callerName, null, acceptIntent, declineIntent, true));
        startRinging(app);

        if (avatarUrl != null) {
            loadAvatarAsync(app, avatarUrl, tag, id, callerName, acceptIntent, declineIntent);
        }
    }

    /** Stops the sound and removes the current call notification (Decline / call_cancel / Accept). */
    static void stopActive(Context context) {
        String tag;
        int id;
        synchronized (LOCK) {
            MAIN_HANDLER.removeCallbacks(STOP_RINGING);
            stopRingtoneLocked();
            tag = activeTag;
            id = activeId;
            activeTag = null;
            activeId = 0;
            appContext = null;
        }
        Context app = context != null ? context.getApplicationContext() : null;
        if (app != null && tag != null) {
            cancelNotification(app, tag, id);
        }
    }

    /** Handles {@code type=call_cancel} for one call id. */
    static void stopForCall(Context context, String callId) {
        stopActive(context);
        if (callId == null) return;
        Context app = context != null ? context.getApplicationContext() : null;
        if (app != null) {
            cancelNotification(app, TAG_PREFIX + callId, stableId(callId));
        }
    }

    /** True when this intent is an Accept tap for a call (extra or {@code ?call=} deep link). */
    static boolean isCallIntent(Intent intent) {
        if (intent == null) return false;
        try {
            if (intent.hasExtra(EXTRA_CALL_ID)) return true;
            Uri data = intent.getData();
            return data != null && data.getQueryParameter("call") != null;
        } catch (Exception ignored) {
            return false;
        }
    }

    /**
     * Called from MainActivity when a call deep link arrives (Accept or a
     * full-screen intent). The user is now in the call UI, so the alert stops.
     */
    static void handleMainActivityIntent(Context context, Intent intent) {
        if (!isCallIntent(intent)) return;
        try {
            stopActive(context);
        } catch (Exception ignored) {
            // Opening the app must never fail because the alert cleanup did.
        }
    }

    private static PendingIntent buildAcceptIntent(Context context, String callId, int requestCode) {
        Intent accept = new Intent(context, MainActivity.class);
        accept.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // The web client reads the call id from the query string.
        accept.setData(callDeepLink(context, callId));
        accept.putExtra(EXTRA_CALL_ID, callId);
        return PendingIntent.getActivity(
                context,
                requestCode,
                accept,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static PendingIntent buildDeclineIntent(Context context, String callId, String tag, int notificationId) {
        Intent decline = new Intent(context, CallActionReceiver.class);
        decline.setAction(ACTION_DECLINE_CALL);
        decline.putExtra(EXTRA_CALL_ID, callId);
        decline.putExtra(EXTRA_NOTIFICATION_TAG, tag);
        decline.putExtra(EXTRA_NOTIFICATION_ID, notificationId);
        return PendingIntent.getBroadcast(
                context,
                notificationId + 1,
                decline,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private static Notification buildNotification(
            Context context,
            String callerName,
            Bitmap largeIcon,
            PendingIntent acceptIntent,
            PendingIntent declineIntent,
            boolean allowFullScreen
    ) {
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, NotifierNotifications.CHANNEL_CALLS)
                .setSmallIcon(R.mipmap.ic_launcher_foreground)
                .setContentTitle(callerName)
                .setContentText("Incoming Chatgram call")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(acceptIntent)
                .addAction(android.R.drawable.ic_menu_call, "Accept", acceptIntent)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declineIntent);

        if (largeIcon != null) {
            builder.setLargeIcon(largeIcon);
        }

        // Android 14+ may deny full-screen intents for non-call/alarm apps; then
        // the high-importance calls channel still produces a heads-up alert.
        if (allowFullScreen && PushRegistrar.canUseFullScreenIntent(context)) {
            builder.setFullScreenIntent(acceptIntent, true);
        }
        return builder.build();
    }

    private static void postNotification(Context context, String tag, int id, Notification notification) {
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(tag, id, notification);
            }
        } catch (Exception ignored) {
            // Missing POST_NOTIFICATIONS or a blocked channel: no crash.
        }
    }

    private static void cancelNotification(Context context, String tag, int id) {
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.cancel(tag, id);
            }
        } catch (Exception ignored) {
            // Nothing to cancel.
        }
    }

    private static void startRinging(Context context) {
        synchronized (LOCK) {
            stopRingtoneLocked();
            try {
                Uri uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (uri == null) {
                    uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                }
                MediaPlayer player = new MediaPlayer();
                player.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
                player.setDataSource(context, uri);
                player.setLooping(true);
                player.prepare();
                player.start();
                ringtone = player;
            } catch (Exception ignored) {
                ringtone = null;
            }
            MAIN_HANDLER.removeCallbacks(STOP_RINGING);
            MAIN_HANDLER.postDelayed(STOP_RINGING, RING_TIMEOUT_MS);
        }
    }

    private static void stopRingtoneLocked() {
        if (ringtone != null) {
            try {
                if (ringtone.isPlaying()) {
                    ringtone.stop();
                }
            } catch (Exception ignored) {
                // Already stopped.
            }
            try {
                ringtone.release();
            } catch (Exception ignored) {
                // Already released.
            }
            ringtone = null;
        }
    }

    private static void loadAvatarAsync(
            Context context,
            String avatarUrl,
            String tag,
            int id,
            String callerName,
            PendingIntent acceptIntent,
            PendingIntent declineIntent
    ) {
        Thread thread = new Thread(() -> {
            Bitmap bitmap = downloadAvatar(avatarUrl);
            if (bitmap == null) return;
            MAIN_HANDLER.post(() -> {
                synchronized (LOCK) {
                    if (!tag.equals(activeTag)) return; // call already ended
                }
                // Re-posting the same (tag, id) only updates the large icon; the
                // full-screen intent is not re-armed.
                postNotification(
                        context,
                        tag,
                        id,
                        buildNotification(context, callerName, bitmap, acceptIntent, declineIntent, false)
                );
            });
        }, "chatgram-call-avatar");
        thread.setDaemon(true);
        thread.start();
    }

    private static Bitmap downloadAvatar(String avatarUrl) {
        HttpURLConnection connection = null;
        try {
            URL url = new URL(avatarUrl);
            // usesCleartextTraffic=false in the manifest: only https is allowed.
            if (!"https".equalsIgnoreCase(url.getProtocol())) return null;
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(AVATAR_TIMEOUT_MS);
            connection.setReadTimeout(AVATAR_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "image/*");
            if (connection.getResponseCode() != 200) return null;
            if (connection.getContentLength() > AVATAR_MAX_BYTES) return null;
            try (InputStream raw = connection.getInputStream();
                 BufferedInputStream stream = new BufferedInputStream(raw)) {
                return BitmapFactory.decodeStream(stream);
            }
        } catch (Exception ignored) {
            return null;
        } finally {
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (Exception ignored) {
                    // Nothing to do.
                }
            }
        }
    }

    /** Reads the packaged Capacitor config so the deep link uses the real server URL. */
    private static Uri callDeepLink(Context context, String callId) {
        String base = appBaseUrl(context);
        return Uri.parse(base + "?call=" + Uri.encode(callId));
    }

    private static String appBaseUrl(Context context) {
        try (InputStream raw = context.getAssets().open("capacitor.config.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = raw.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            JSONObject config = new JSONObject(out.toString("UTF-8"));
            JSONObject server = config.optJSONObject("server");
            String url = server == null ? "" : server.optString("url", "");
            if (!url.isEmpty()) return url;
        } catch (Exception ignored) {
            // Fall through to the known hosted URL.
        }
        return FALLBACK_APP_URL;
    }

    private static int stableId(String callId) {
        return callId.hashCode() & 0x7fffffff;
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) return null;
        for (String value : values) {
            if (value != null && !value.isEmpty()) return value;
        }
        return null;
    }
}
