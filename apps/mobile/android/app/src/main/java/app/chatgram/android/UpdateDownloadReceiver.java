package app.chatgram.android;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Legacy entry point for {@code ACTION_DOWNLOAD_COMPLETE}.
 *
 * Kept as a manifest receiver because some older Android versions do deliver the
 * broadcast; the authoritative finish path is {@link UpdateFinalizer} (called by
 * the plugin while the app is open, and by a WorkManager job when it is not).
 *
 * This class deliberately stays thin: the broadcast may arrive in a fresh process
 * where no WebView exists.
 */
public class UpdateDownloadReceiver extends BroadcastReceiver {

    /** Internal (package-scoped) broadcast so a live UI refreshes immediately. */
    static final String ACTION_STATE = "app.chatgram.android.UPDATE_STATE";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
        if (id <= 0 || id != UpdatePrefs.requestId(context)) return;

        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                if (UpdateFinalizer.finalizeIfComplete(app) != UpdateFinalizer.Result.RUNNING) {
                    app.sendBroadcast(new Intent(ACTION_STATE).setPackage(app.getPackageName()));
                }
            } finally {
                pending.finish();
            }
        }, "chatgram-update-finish").start();
    }
}
