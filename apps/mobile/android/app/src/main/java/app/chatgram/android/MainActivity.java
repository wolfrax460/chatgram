package app.chatgram.android;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebSettings;

import com.getcapacitor.BridgeActivity;

/**
 * Chatgram for Android — Capacitor shell.
 *
 * <p>The web client itself is served from https://chatgram-xi.vercel.app/web/
 * (see {@code capacitor.config.json}, {@code server.url}), so this activity only
 * configures the WebView. It must NOT try to load local assets: with a
 * {@code server.url} configured Capacitor ignores them, and the older APK that
 * shipped without {@code server.url} loaded a stale local copy whose scripts
 * 404'd (blank white screen).
 *
 * <p>The class package matters. {@code AndroidManifest.xml} declares the
 * activity as {@code .MainActivity}, which resolves against the Gradle
 * {@code namespace} ({@code app.chatgram.android}). The 1.1.0 APK declared
 * {@code app.chatgram.android.MainActivity} in the manifest but only contained
 * {@code com.chatgram.app.MainActivity} in the dex, so every launch died with
 * {@code ClassNotFoundException "Unable to instantiate activity"} before a
 * single pixel was drawn. Keep this package and the namespace in sync.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local (in-app) Capacitor plugin for chunk 7C: check, download with
        // DownloadManager, verify the SHA-256, then hand off to Android's
        // installer. Must be registered before super.onCreate() so the bridge
        // knows about it when the WebView starts.
        registerPlugin(AppUpdaterPlugin.class);
        // Chunk 8: Android local notifications for new messages while the app is
        // backgrounded (the WebView and its Socket.IO connection are still alive).
        registerPlugin(NotifierPlugin.class);
        // Chunk 8: call audio routing (earpiece / speaker / bluetooth / headset)
        // for the 1:1 call UI, which the WebView cannot control itself.
        registerPlugin(AudioRoutePlugin.class);

        super.onCreate(savedInstanceState);

        // Cold start from a notification tap: remember the chat before the web
        // layer loads. (BridgeActivity.load() already replays the launch intent
        // through onNewIntent(); this is a no-op in that case because the extras
        // were consumed there.)
        NotifierStore.captureFromIntent(this, getIntent());

        WebSettings settings = getBridge().getWebView().getSettings();

        // Voice notes and call audio must be allowed to play without a fresh tap.
        settings.setMediaPlaybackRequiresUserGesture(false);
        // Keep the normal HTTP cache: a cold start of the shell reuses the
        // already-downloaded web client instead of re-fetching every chunk.
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // The app talks HTTPS only; never let a page downgrade to HTTP.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        // Update checks: ~12 h in the background, plus one now when the last
        // check is older than 6 h (so a fresh release is seen without waiting).
        UpdateWorker.schedulePeriodic(this);
        if (UpdatePrefs.lastCheckedAt(this) < System.currentTimeMillis() - 6 * 60 * 60 * 1000L) {
            UpdateWorker.checkNow(this);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // A message-notification tap reuses this singleTask activity. Record the
        // chat id; the web layer drains it with Notifier.consumePending() when it
        // is running (it may be paused behind the notification shade).
        NotifierStore.captureFromIntent(this, intent);
    }
}
