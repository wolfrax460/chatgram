package app.chatgram.android;

import android.content.Context;

import androidx.annotation.NonNull;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * FCM entry point for the Chatgram Android shell.
 *
 * <p>Extends the Capacitor push-notifications plugin's own service (the plugin
 * dependency already has one) and calls {@code super} first, so the plugin's
 * {@code pushNotificationReceived}/{@code pushNotificationActionPerformed} JS
 * events keep working while native Chatgram notifications are handled here. The
 * library's service declaration is removed in our manifest (tools:node="remove"),
 * so this is the single FCM {@code MESSAGING_EVENT} receiver.
 *
 * <p>Server contract (data-only messages — the payload must contain {@code data},
 * not a {@code notification} block, so this service always runs):
 * <ul>
 *   <li>{@code type=message}: {@code chatId}, {@code title}/{@code senderName},
 *       {@code body}/{@code preview}, optional {@code hidePreview=true}.</li>
 *   <li>{@code type=call}: {@code callId}, {@code callerName}, optional
 *       {@code avatar}, optional {@code chatId}.</li>
 *   <li>{@code type=call_cancel}: {@code callId}; stops ringing + removes the
 *       incoming-call notification.</li>
 * </ul>
 *
 * <p>When the process has been killed, Android starts it for a data message (or
 * for the FCM notification payload) — this is exactly the case local
 * notifications from the WebView could not cover in round 1.1.6.
 */
public class ChatgramMessagingService extends MessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        // super forwards the new token to the Capacitor push plugin listeners.
        super.onNewToken(token);
        try {
            PushStore.setToken(getApplicationContext(), token);
        } catch (Exception ignored) {
            // A token refresh must never crash the push service.
        }
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        // super fires the Capacitor pushNotificationReceived event (if a page is live).
        super.onMessageReceived(remoteMessage);
        try {
            handleMessage(getApplicationContext(), remoteMessage.getData());
        } catch (Exception ignored) {
            // A malformed push payload must never crash the app.
        }
    }

    private void handleMessage(Context context, Map<String, String> data) {
        if (data == null || data.isEmpty()) return;

        String type = firstNonEmpty(data.get("type"));
        String chatId = firstNonEmpty(data.get("chatId"), data.get("chat_id"));

        if ("call_cancel".equalsIgnoreCase(type)) {
            CallAlerts.stopForCall(context, firstNonEmpty(data.get("callId"), data.get("call_id")));
            return;
        }

        if ("call".equalsIgnoreCase(type)) {
            CallAlerts.showIncomingCall(context, data);
            return;
        }

        // Missing type: still treat a chat payload as a message so older server
        // versions keep working.
        if ("message".equalsIgnoreCase(type) || chatId != null) {
            showMessage(context, data, chatId);
        }
    }

    private void showMessage(Context context, Map<String, String> data, String chatId) {
        boolean hidePreview = isTrue(firstNonEmpty(data.get("hidePreview"), data.get("hide_preview")));
        String title = firstNonEmpty(
                data.get("title"),
                data.get("senderName"),
                data.get("sender_name"),
                data.get("from")
        );
        if (title == null) title = "Chatgram";

        String body = firstNonEmpty(
                data.get("body"),
                data.get("preview"),
                data.get("message"),
                data.get("text")
        );
        // Privacy: never render the message content when the server says so.
        if (hidePreview || body == null) body = "New message";

        // id 0 + tag=chatId = one notification per chat (a new message replaces
        // the previous one, same as Notifier.notify({chatId})).
        NotifierNotifications.post(
                context,
                0,
                title,
                body,
                chatId,
                chatId,
                NotifierNotifications.CHANNEL_ID,
                false
        );
    }

    private static boolean isTrue(String value) {
        if (value == null) return false;
        String normalised = value.trim();
        return "true".equalsIgnoreCase(normalised) || "1".equals(normalised) || "yes".equalsIgnoreCase(normalised);
    }

    private static String firstNonEmpty(String... values) {
        if (values == null) return null;
        for (String value : values) {
            if (value != null && !value.isEmpty()) return value;
        }
        return null;
    }
}
