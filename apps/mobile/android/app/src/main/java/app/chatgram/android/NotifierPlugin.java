package app.chatgram.android;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

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
 * {@code Notifier} — Android local notifications for new chat messages.
 *
 * <p>The web client already holds the Socket.IO connection, so it decides when a
 * message is "new while not in the foreground" and calls this plugin. The
 * notification is posted by this app process; there is no remote push.
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
 *   notify({ id?, title, body, chatId?, tag? }) -> void
 *   cancel({ id?, tag? }) -> void
 *   cancelAll() -> void
 *   consumePending() -> { chatId: string | null }
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
        // Create the "messages" channel when the bridge starts, so it exists
        // before the first notification (and shows up in Android Settings).
        NotifierNotifications.ensureChannel(getContext());
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
     * Posts or replaces one notification.
     *
     * <p>Arguments: {@code id} (default 0), {@code title} (default "New
     * message"), {@code body} (default ""), {@code chatId}, {@code tag}. The
     * same (tag, id) pair replaces the previous notification; the default
     * identity is per chat ({@code tag = chatId}, {@code id = 0}).
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

            if (title == null) title = "New message";
            if (body == null) body = "";

            NotifierNotifications.post(getContext(), id, title, body, chatId, tag);
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

    /** Removes every message notification posted by this plugin. */
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
