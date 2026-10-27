package app.chatgram.android;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.service.notification.StatusBarNotification;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import java.util.UUID;

/**
 * Local (in-process) message notifications for Chatgram.
 *
 * <p><b>Scope:</b> these are Android local notifications posted by our own app
 * process while the WebView/Capacitor bridge (and therefore the Socket.IO
 * connection) is still alive. They cover a locked screen or another app being in
 * the foreground. REAL push for "the app process was killed" needs FCM (a server
 * push through Google Play services), which is a later round because no Firebase
 * credentials exist yet — there is deliberately no FCM dependency here.
 */
final class NotifierNotifications {

    /** The one channel for new messages. Created when the plugin is loaded. */
    static final String CHANNEL_ID = "messages";
    static final String CHANNEL_NAME = "Messages";

    /** Base key; per-chat notifications add the chat/tag so each chat groups itself. */
    private static final String GROUP_KEY = "app.chatgram.android.messages";

    /**
     * The project has no dedicated notification icon and we must not add binary
     * assets. The only icon artwork present is the launcher set, so reuse its
     * plain-PNG foreground ({@code mipmap-*}{@code /ic_launcher_foreground.png},
     * which the adaptive icon already references). It is distinct from the
     * system download icon used by the update notifier.
     */
    private static final int SMALL_ICON = R.mipmap.ic_launcher_foreground;

    private NotifierNotifications() {
    }

    /** Creates the "messages" channel if it does not exist yet (API 26+). */
    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("New Chatgram messages. Tap one to open that chat.");
        channel.enableVibration(true);
        channel.setShowBadge(true);

        // Default notification sound. On API 26+ the channel owns the sound and
        // vibration, so a one-time channel creation is what makes them stick; a
        // user can still change either in Android Settings.
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        if (sound != null) {
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .build();
            channel.setSound(sound, audioAttributes);
        }

        // Re-creating an existing channel only refreshes name/description;
        // importance and sound set by the user are preserved by the platform.
        manager.createNotificationChannel(channel);
    }

    /**
     * Whether a notification may actually be posted right now.
     *
     * <p>Android 13+ needs the POST_NOTIFICATIONS runtime permission; on every
     * version the user can also switch the app's notifications off. Both are
     * treated as "not granted": {@code notify()} then resolves without posting
     * instead of throwing.
     */
    static boolean canPost(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return manager != null && manager.areNotificationsEnabled();
    }

    /**
     * Posts (or replaces) one message notification.
     *
     * <p>Identity follows Android's own rule: the (tag, id) pair. With the web
     * layer's defaults that means the same chat replaces its previous
     * notification ({@code tag = chatId}, {@code id = 0}), while a per-message
     * {@code id} keeps several messages of one chat. Every notification is also
     * put in a per-chat group so Android can bundle them.
     */
    static void post(Context context, int id, String title, String body, String chatId, String tag) {
        ensureChannel(context);
        if (!canPost(context)) return;

        String resolvedTag = firstNonEmpty(tag, chatId);
        String groupKey = groupKey(chatId, resolvedTag);

        Intent intent = new Intent(context, MainActivity.class);
        // The manifest already uses launchMode="singleTask"; these flags make the
        // tap reuse the existing task/activity (onNewIntent) instead of stacking.
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra(NotifierStore.EXTRA_ID, id);
        if (resolvedTag != null) intent.putExtra(NotifierStore.EXTRA_TAG, resolvedTag);
        if (chatId != null) intent.putExtra(NotifierStore.EXTRA_CHAT_ID, chatId);
        // Fresh token per posted notification: lets the tap handler ignore the
        // launch intent Android replays after an activity/process recreation.
        intent.putExtra(NotifierStore.EXTRA_TAP_ID, UUID.randomUUID().toString());

        // One distinct request code per (chat, tag, id): PendingIntents compare
        // without their extras, so a shared request code would let the last tap's
        // chatId overwrite every other notification's target.
        PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                requestCode(chatId, resolvedTag, id),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(SMALL_ICON)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setGroup(groupKey)
                .setGroupSummary(false)
                .setContentIntent(contentIntent);

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            // autoCancel removes the notification when the content intent fires.
            Notification notification = builder.build();
            if (resolvedTag != null) {
                manager.notify(resolvedTag, id, notification);
            } else {
                manager.notify(id, notification);
            }
        } catch (SecurityException ignored) {
            // Permission revoked between the check above and notify(): stay silent.
        }
    }

    /** Removes one message notification, using the same (tag, id) identity as {@link #post}. */
    static void cancel(Context context, int id, String tag) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String resolvedTag = firstNonEmpty(tag, null);
        try {
            if (resolvedTag != null) {
                manager.cancel(resolvedTag, id);
            } else {
                manager.cancel(id);
            }
        } catch (Exception ignored) {
            // Nothing to cancel.
        }
    }

    /**
     * Removes every notification this notifier posted.
     *
     * <p>On API 26+ the channel id is the filter, so the updater's "Update ready"
     * notification (a different channel) is untouched. API 24/25 have no
     * channels; there the only other notification is the updater's, which is
     * cancelled too — acceptable on those two legacy versions.
     */
    static void cancelAll(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            for (StatusBarNotification active : manager.getActiveNotifications()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        && !CHANNEL_ID.equals(active.getNotification().getChannelId())) {
                    continue;
                }
                String tag = active.getTag();
                if (tag != null) {
                    manager.cancel(tag, active.getId());
                } else {
                    manager.cancel(active.getId());
                }
            }
        } catch (Exception ignored) {
            // Some OEM builds refuse getActiveNotifications(); cancelling is best effort.
        }
    }

    private static String groupKey(String chatId, String tag) {
        if (chatId != null) return GROUP_KEY + ".chat." + chatId;
        if (tag != null) return GROUP_KEY + ".tag." + tag;
        return GROUP_KEY;
    }

    private static int requestCode(String chatId, String tag, int id) {
        int hash = 7;
        hash = 31 * hash + (chatId == null ? 0 : chatId.hashCode());
        hash = 31 * hash + (tag == null ? 0 : tag.hashCode());
        hash = 31 * hash + id;
        return hash;
    }

    private static String firstNonEmpty(String first, String second) {
        if (first != null && !first.isEmpty()) return first;
        if (second != null && !second.isEmpty()) return second;
        return null;
    }
}
