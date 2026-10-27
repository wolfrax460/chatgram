package app.chatgram.android;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;

/**
 * The one notification Chatgram posts for updates, plus the install intent.
 *
 * Android never installs an APK silently outside the Play Store, so this is as
 * far as automation goes: download → verify → "Update ready: tap to install" →
 * the system installer (one tap, plus the one-time "install unknown apps"
 * approval).
 */
final class UpdateNotifier {

    static final String CHANNEL_ID = "chatgram_updates";
    private static final int NOTIFICATION_ID = 7107;

    private UpdateNotifier() {
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "App updates",
                NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Tells you when a Chatgram update has downloaded and is ready to install.");
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    /** Does this app have permission to post notifications right now? */
    static boolean notificationsAllowed(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return NotificationManagerCompatAllowed(context);
    }

    private static boolean NotificationManagerCompatAllowed(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        return manager != null && manager.areNotificationsEnabled();
    }

    /** "Update ready: tap to install" — no-op when notifications are blocked. */
    static void notifyReady(Context context, String version) {
        if (!notificationsAllowed(context)) return;
        ensureChannel(context);
        File apk = UpdatePaths.downloadedFile(context);
        if (apk == null || !apk.isFile()) return;

        Intent install = installIntent(context, apk);
        PendingIntent pending = PendingIntent.getActivity(
                context,
                1,
                install,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("Update ready: tap to install")
                .setContentText("Chatgram " + version + " has downloaded. Tap to install it.")
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .build();

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, notification);
    }

    static void cancel(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.cancel(NOTIFICATION_ID);
    }

    /** Can this app launch the package installer at all? */
    static boolean canInstallPackages(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            return context.getPackageManager().canRequestPackageInstalls();
        }
        return true;
    }

    /**
     * Intent that opens Android's installer for the verified file. The caller
     * must have checked {@link #canInstallPackages(Context)} first, otherwise the
     * system shows a confusing error instead of the approval screen.
     */
    static Intent installIntent(Context context, File apk) {
        Uri uri = FileProvider.getUriForFile(
                context,
                context.getPackageName() + ".fileprovider",
                apk
        );
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return intent;
    }

    /** The one-time "Install unknown apps → Chatgram → Allow" screen. */
    static boolean openInstallSettings(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false;
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }
}
