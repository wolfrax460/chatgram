package app.chatgram.android;

import android.Manifest;
import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessaging;

/**
 * FCM registration for the Android shell.
 *
 * <p>The APK loads the hosted web client, so nothing on the page can obtain a
 * device token by itself. This helper (called once from {@code MainActivity})
 * makes sure the notification channels exist (the FCM default channel is
 * {@code messages}), asks for POST_NOTIFICATIONS on Android 13+, and fetches the
 * FCM token into {@link PushStore}. Token refreshes are handled by
 * {@link ChatgramMessagingService#onNewToken}.
 *
 * <p>No Firebase credentials live in this file: {@code google-services.json}
 * (gitignored) is processed by the Google Services Gradle plugin.
 */
final class PushRegistrar {

    /** Callback used by the Notifier plugin's token methods (may run on another thread). */
    interface TokenCallback {
        void onToken(String token);
    }

    /** Callback used by Notifier.deleteFcmToken(). */
    interface DeleteCallback {
        void onDeleted(boolean deleted);
    }

    private static final int NOTIFICATIONS_REQUEST_CODE = 7401;

    private PushRegistrar() {
    }

    /** Called from MainActivity.onCreate(), after the bridge exists. */
    static void register(Activity activity) {
        if (activity == null) return;
        Context context = activity.getApplicationContext();
        // The FCM default channel for notification payloads is "messages"
        // (manifest meta-data), so it must exist before the first push arrives.
        try {
            NotifierNotifications.ensureChannels(context);
        } catch (Exception ignored) {
            // A failed channel creation must not break app start.
        }
        requestNotificationsPermission(activity);
        fetchToken(context, null);
    }

    /** Android 13+ runtime permission; a no-op on older versions. */
    static void requestNotificationsPermission(Activity activity) {
        if (activity == null) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return;
        try {
            if (hasNotificationsPermission(activity)) return;
            ActivityCompat.requestPermissions(
                    activity,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    NOTIFICATIONS_REQUEST_CODE
            );
        } catch (Exception ignored) {
            // The web layer can retry through Notifier.requestPermission().
        }
    }

    static boolean hasNotificationsPermission(Context context) {
        try {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** Fetches the current FCM token (and stores it). Never throws. */
    static void fetchToken(Context context, TokenCallback callback) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                String token = null;
                try {
                    if (task.isSuccessful()) {
                        token = task.getResult();
                    }
                } catch (Exception ignored) {
                    token = null;
                }
                if (token != null && !token.isEmpty()) {
                    PushStore.setToken(context, token);
                }
                if (callback != null) {
                    try {
                        callback.onToken(token);
                    } catch (Exception ignored) {
                        // The bridge call may already be gone.
                    }
                }
            });
        } catch (Exception ignored) {
            if (callback != null) {
                try {
                    callback.onToken(null);
                } catch (Exception ignoredToo) {
                    // Nothing to do.
                }
            }
        }
    }

    /** Deletes the FCM token on this device (e.g. on sign-out). Never throws. */
    static void deleteToken(Context context, DeleteCallback callback) {
        try {
            FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> {
                boolean deleted = false;
                try {
                    deleted = task.isSuccessful();
                } catch (Exception ignored) {
                    deleted = false;
                }
                if (deleted) {
                    PushStore.clearToken(context);
                }
                if (callback != null) {
                    try {
                        callback.onDeleted(deleted);
                    } catch (Exception ignored) {
                        // The bridge call may already be gone.
                    }
                }
            });
        } catch (Exception ignored) {
            if (callback != null) {
                try {
                    callback.onDeleted(false);
                } catch (Exception ignoredToo) {
                    // Nothing to do.
                }
            }
        }
    }

    /**
     * Android 14+ lets the user deny full-screen intents for non-call/alarm
     * apps. When that is the case, call alerts fall back to a heads-up
     * notification instead of failing silently.
     */
    static boolean canUseFullScreenIntent(Context context) {
        if (Build.VERSION.SDK_INT < 34) return true;
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            return manager != null && manager.canUseFullScreenIntent();
        } catch (Exception ignored) {
            return false;
        }
    }
}
