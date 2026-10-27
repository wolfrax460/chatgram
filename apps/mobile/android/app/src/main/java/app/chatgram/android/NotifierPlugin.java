package app.chatgram.android;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

/**
 * {@code Notifier} — Android local notifications for new messages and calls.
 *
 * <p>The web client already holds the Socket.IO connection, so it decides when a
 * notification is due and calls this plugin. The notification is posted by this
 * app process; there is no remote push.
 *
 * <p><b>Not FCM:</b> a notification while the app process is dead (force-stopped,
 * swiped away or killed by the system) is impossible this way. That needs a
 * server push through FCM, which is a later round — hence no Firebase
 * dependency in this build. This covers screen-locked / other-app-in-front with
 * the process alive.
 *
 * <p>JS surface (all called through Capacitor, method names/arguments fixed):
 * <pre>
 *   requestPermission() -> { granted: boolean, status: string }
 *   getPermission()     -> { granted: boolean, status: string }
 *   openSettings()      -> { opened: boolean }   system notification settings
 *   notify({ id?, title, body, chatId?, tag?, channel?, ongoing? }) -> void
 *        channel: 'messages' | 'calls' | 'general' (default 'messages')
 *        ongoing: boolean (default false; non-dismissible, no auto-cancel)
 *   cancel({ id?, tag? }) -> void
 *   cancelAll() -> void
 *   consumePending() -> { chatId: string | null }
 *   batteryOptimization() -> { ignoring: boolean }
 *   requestBatteryExemption() -> { opened: boolean }
 * </pre>
 * {@code notify} resolves without posting when notifications are not allowed.
 */
@CapacitorPlugin(
        name = "Notifier",
        permissions = {
                @Permission(
                        alias = "notifications",
                        strings = { Manifest.permission.POST_NOTIFICATIONS }
                )
        }
)
public class NotifierPlugin extends Plugin {

    private static final String PERMISSION_ALIAS = "notifications";

    @Override
    public void load() {
        // Create the "messages", "calls" and "general" channels when the bridge
        // starts, so they exist before the first notification (and show up in
        // Android Settings).
        NotifierNotifications.ensureChannels(getContext());
    }

    /**
     * Requests POST_NOTIFICATIONS on Android 13+; resolves only after the user
     * has answered. Below API 33 there is no runtime permission, so it resolves
     * granted immediately (the app can still be blocked in system settings;
     * notify() then no-ops).
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasRuntimePermission()) {
            call.resolve(permissionResult(true));
            return;
        }
        requestPermissionForAlias(PERMISSION_ALIAS, call, "notificationsPermissionCallback");
    }

    @PermissionCallback
    private void notificationsPermissionCallback(PluginCall call) {
        if (call == null) return;
        call.resolve(permissionResult(hasRuntimePermission()));
    }

    /** Current state without prompting. */
    @PluginMethod
    public void getPermission(PluginCall call) {
        boolean granted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || hasRuntimePermission();
        call.resolve(permissionResult(granted));
    }

    /**
     * Opens the system notification settings for this app, where the user can
     * switch notifications (and each channel) back on.
     *
     * <p>API 26+ opens the app's notification settings directly; anything older
     * (or a device without that screen) falls back to the app's details page.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Context context = getContext();
        boolean opened = false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                opened = true;
            } catch (Exception ignored) {
                opened = false;
            }
        }

        if (!opened) {
            opened = openAppDetails(context);
        }

        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }

    /** Fallback settings screen: "App info" for this package. */
    private boolean openAppDetails(Context context) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + context.getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(intent);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    /** Is this app currently exempt from battery optimization (Doze)? */
    @PluginMethod
    public void batteryOptimization(PluginCall call) {
        boolean ignoring = false;
        try {
            PowerManager powerManager = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                ignoring = powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
            }
        } catch (Exception ignored) {
            ignoring = false;
        }

        JSObject result = new JSObject();
        result.put("ignoring", ignoring);
        call.resolve(result);
    }

    /**
     * Asks Android for the battery-optimization exemption. Shows the system
     * dialog; the user can still refuse, so callers should re-check with
     * {@link #batteryOptimization(PluginCall)} afterwards.
     */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        boolean opened = false;
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            opened = true;
        } catch (Exception ignored) {
            opened = false;
        }

        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }

    /**
     * Posts or replaces one notification.
     *
     * <p>Arguments: {@code id} (default 0), {@code title} (default "New
     * message"), {@code body} (default ""), {@code chatId}, {@code tag},
     * {@code channel} ({@code messages}/{@code calls}/{@code general}, default
     * {@code messages}), {@code ongoing} (default false). The same (tag, id)
     * pair replaces the previous notification; the default identity is per chat
     * ({@code tag = chatId}, {@code id = 0}).
     */
    @PluginMethod
    public void notify(PluginCall call) {
        try {
            Integer rawId = call.getInt("id", 0);
            int id = rawId == null ? 0 : rawId;
            String title = trimToNull(call.getString("title", "New message"));
            String body = call.getString("body", "");
            String chatId = trimToNull(call.getString("chatId"));
            String tag = trimToNull(call.getString("tag"));
            String channel = NotifierNotifications.normalizeChannel(trimToNull(call.getString("channel")));
            boolean ongoing = Boolean.TRUE.equals(call.getBoolean("ongoing", false));

            if (title == null) title = "New message";
            if (body == null) body = "";

            NotifierNotifications.post(getContext(), id, title, body, chatId, tag, channel, ongoing);
        } catch (Exception ignored) {
            // A notification must never reject into the web layer: not posting is
            // the only acceptable failure mode.
        }
        call.resolve();
    }

    /** Removes one notification by the same (tag, id) identity used in notify(). */
    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            Integer rawId = call.getInt("id", 0);
            int id = rawId == null ? 0 : rawId;
            String tag = trimToNull(call.getString("tag"));
            NotifierNotifications.cancel(getContext(), id, tag);
        } catch (Exception ignored) {
            // Cancelling a notification that does not exist is not an error.
        }
        call.resolve();
    }

    /** Removes every notification this plugin posted (messages, calls, general). */
    @PluginMethod
    public void cancelAll(PluginCall call) {
        try {
            NotifierNotifications.cancelAll(getContext());
        } catch (Exception ignored) {
            // Best effort.
        }
        call.resolve();
    }

    /**
     * The chat id of the last notification tap, cleared once read. Stored in
     * SharedPreferences, so it survives the activity/process being recreated
     * between the tap and this call.
     */
    @PluginMethod
    public void consumePending(PluginCall call) {
        JSObject result = new JSObject();
        String chatId = NotifierStore.consumePendingChatId(getContext());
        result.put("chatId", chatId == null ? JSONObject.NULL : chatId);
        call.resolve(result);
    }

    private boolean hasRuntimePermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private static JSObject permissionResult(boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        result.put("status", granted ? "granted" : "denied");
        return result;
    }

    private static String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
