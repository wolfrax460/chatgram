package app.chatgram.android;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;

import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.io.File;

/**
 * {@code AppUpdater} — the Android half of chunk 7C.
 *
 * JS surface (all methods are awaited from the web layer):
 *   getState()            → { status, required, version, notes, size, downloaded,
 *                             total, error, lastCheckedAt, wifiOnly, ... }
 *   check()               → contacts /api/app/version, decides optional/required
 *   download()            → DownloadManager (Wi-Fi OR mobile data by default)
 *   install()             → opens Android's installer for the verified APK
 *   setWifiOnly(bool)     → opt-in data saving (default: either network)
 *   openInstallSettings() → the one-time "install unknown apps" screen
 *   dismiss()             → clears a ready/available state
 *   getInstalledVersion() → { version, versionCode }
 *
 * Event: {@code updateState} with the same payload as getState().
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    /**
     * The DownloadManager receiver finishes downloads outside the WebView's
     * lifecycle; this listener just forwards that to the running page so the
     * banner flips to "ready" without polling.
     */
    private final BroadcastReceiver stateReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            emit();
        }
    };

    @Override
    public void load() {
        UpdateNotifier.ensureChannel(getContext());
        ContextCompat.registerReceiver(
                getContext(),
                stateReceiver,
                new IntentFilter(UpdateDownloadReceiver.ACTION_STATE),
                ContextCompat.RECEIVER_NOT_EXPORTED
        );
        // Manifest receivers no longer get implicit broadcasts on Android 8+, so
        // listen while the app is alive and finalise immediately.
        android.content.IntentFilter complete = new android.content.IntentFilter(android.app.DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        ContextCompat.registerReceiver(getContext(), new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                getBridge().execute(() -> {
                    UpdateFinalizer.finalizeIfComplete(getContext());
                    emit();
                });
            }
        }, complete, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        try {
            getContext().unregisterReceiver(stateReceiver);
        } catch (Exception ignored) {
            // already unregistered
        }
    }

    private void emit() {
        notifyListeners("updateState", UpdatePrefs.toJson(getContext()));
    }

    @PluginMethod
    public void getState(PluginCall call) {
        // Opening Settings (or the app) is enough to finish a download that
        // completed while the app was closed.
        if (UpdatePrefs.requestId(getContext()) > 0 && !"ready".equals(UpdatePrefs.state(getContext()))) {
            UpdateFinalizer.finalizeIfComplete(getContext());
        }
        call.resolve(UpdatePrefs.toJson(getContext()));
    }

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        JSObject result = new JSObject();
        result.put("version", AppVersion.name(getContext()));
        result.put("versionCode", AppVersion.code(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void setWifiOnly(PluginCall call) {
        boolean wifiOnly = Boolean.TRUE.equals(call.getBoolean("wifiOnly", false));
        UpdatePrefs.setWifiOnly(getContext(), wifiOnly);
        JSObject result = new JSObject();
        result.put("wifiOnly", wifiOnly);
        emit();
        call.resolve(result);
    }

    @PluginMethod
    public void check(PluginCall call) {
        getBridge().execute(() -> {
            try {
                UpdatePrefs.setState(getContext(), "checking");
                emit();

                VersionClient.Info info = VersionClient.fetch(AppVersion.name(getContext()), AppVersion.code(getContext()));
                UpdatePrefs.setChecked(getContext());

                VersionClient.Action action = VersionClient.decide(info, AppVersion.name(getContext()), AppVersion.code(getContext()));
                if (action == VersionClient.Action.NONE) {
                    UpdatePrefs.setState(getContext(), "idle");
                    JSObject idle = new JSObject();
                    idle.put("status", "idle");
                    idle.put("upToDate", true);
                    emit();
                    call.resolve(idle);
                    return;
                }

                boolean required = action == VersionClient.Action.REQUIRED;
                UpdatePrefs.setAvailable(getContext(), info, required);
                emit();
                call.resolve(UpdatePrefs.toJson(getContext()));
            } catch (Exception error) {
                UpdatePrefs.setError(getContext(), "Could not check for updates.");
                emit();
                call.reject("Could not check for updates.", error);
            }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        getBridge().execute(() -> {
            try {
                long id = UpdateDownloader.enqueue(getContext());
                emit();
                JSObject result = UpdatePrefs.toJson(getContext());
                result.put("requestId", id);
                call.resolve(result);
            } catch (Exception error) {
                String message = error.getMessage() == null ? "The download could not be started." : error.getMessage();
                UpdatePrefs.setError(getContext(), message);
                emit();
                call.reject(message, error);
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        try {
            File apk = UpdatePaths.downloadedFile(getContext());
            if (apk == null || !apk.isFile()) {
                call.reject("The update has not been downloaded yet.");
                return;
            }
            if (!UpdateFile.verify(apk, UpdatePrefs.expectedSha256(getContext()))) {
                UpdatePrefs.setError(getContext(), "The downloaded update failed its checksum and was removed.");
                emit();
                call.reject("The downloaded update failed its checksum and was removed.");
                return;
            }
            if (!UpdateNotifier.canInstallPackages(getContext())) {
                // Android requires the one-time approval before any installer runs.
                UpdateNotifier.openInstallSettings(getContext());
                JSObject result = new JSObject();
                result.put("needsPermission", true);
                call.resolve(result);
                return;
            }
            Intent installer = UpdateNotifier.installIntent(getContext(), apk);
            getActivity().startActivity(installer);
            UpdateNotifier.cancel(getContext());
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("The installer could not be opened.", error);
        }
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        boolean opened = UpdateNotifier.openInstallSettings(getContext());
        JSObject result = new JSObject();
        result.put("opened", opened);
        call.resolve(result);
    }

    @PluginMethod
    public void dismiss(PluginCall call) {
        UpdatePrefs.clearReady(getContext());
        emit();
        call.resolve(UpdatePrefs.toJson(getContext()));
    }
}
