package app.chatgram.android;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Decline / cancel action for an incoming-call notification.
 *
 * <p>The notification's "Decline" button sends a broadcast here (a broadcast can
 * stop the ringtone without starting an activity, which Android 12+ would
 * otherwise block as a notification trampoline). Accept, by contrast, goes
 * straight to {@code MainActivity} with the call deep link.
 */
public class CallActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || context == null) return;
        try {
            if (CallAlerts.ACTION_DECLINE_CALL.equals(intent.getAction())) {
                // The activity may be dead; cancel by the ids carried in the
                // intent as well as by the in-memory active call.
                String tag = intent.getStringExtra(CallAlerts.EXTRA_NOTIFICATION_TAG);
                int id = intent.getIntExtra(CallAlerts.EXTRA_NOTIFICATION_ID, -1);
                CallAlerts.stopActive(context);
                if (tag != null && id >= 0) {
                    android.app.NotificationManager manager =
                            (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                    if (manager != null) {
                        manager.cancel(tag, id);
                    }
                }
            }
        } catch (Exception ignored) {
            // A decline action must never crash the app.
        }
    }
}
