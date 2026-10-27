package app.chatgram.android;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Locale;

/**
 * {@code AudioRoute} — voice-call audio routing for the Chatgram WebView.
 *
 * <p>The WebView has no API for choosing the call output, so a 1:1 call would
 * otherwise always use whatever Android picks. This plugin exposes the four
 * routes the call UI offers:
 *
 * <pre>
 *   getRoute() -> { route: 'earpiece'|'speaker'|'bluetooth'|'headset',
 *                   bluetoothAvailable: boolean }
 *   setRoute({ route }) -> { route }
 *   reset() -> { route }
 * </pre>
 *
 * <p>Implementation notes:
 * <ul>
 *   <li>{@code setRoute} puts audio into {@link AudioManager#MODE_IN_COMMUNICATION}
 *       (the mode a call UI needs) and {@code reset()} restores
 *       {@link AudioManager#MODE_NORMAL}; {@code reset()} is also called from
 *       {@code handleOnDestroy} so a WebView reload cannot leave the phone in
 *       call mode.</li>
 *   <li>Bluetooth uses the legacy SCO API ({@code startBluetoothSco()} /
 *       {@code setBluetoothScoOn(true)} on API &lt; 31, {@code stopBluetoothSco()}
 *       when leaving it). On Android 12+ {@code BLUETOOTH_CONNECT} is a runtime
 *       permission: without it the plugin keeps the current route instead of
 *       throwing across the bridge.</li>
 * </ul>
 *
 * <p>Every method resolves with a route, even on a broken OEM audio stack; this
 * plugin never rejects a JS call.
 */
@CapacitorPlugin(name = "AudioRoute")
public class AudioRoutePlugin extends Plugin {

    private static final String ROUTE_EARPIECE = "earpiece";
    private static final String ROUTE_SPEAKER = "speaker";
    private static final String ROUTE_BLUETOOTH = "bluetooth";
    private static final String ROUTE_HEADSET = "headset";

    /** The current output route, plus whether a Bluetooth device is available. */
    @PluginMethod
    public void getRoute(PluginCall call) {
        AudioManager audioManager = audioManager();
        JSObject result = new JSObject();
        result.put("route", currentRoute(audioManager));
        result.put("bluetoothAvailable", bluetoothAvailable(audioManager));
        call.resolve(result);
    }

    /** Switches call audio to the requested route and resolves with the active one. */
    @PluginMethod
    public void setRoute(PluginCall call) {
        String requested = normalizeRoute(call.getString("route"));
        AudioManager audioManager = audioManager();
        if (requested != null && audioManager != null) {
            applyRoute(audioManager, requested);
        }
        call.resolve(routeOnly(currentRoute(audioManager)));
    }

    /** Leaves call mode: normal audio mode, speaker off, SCO stopped. */
    @PluginMethod
    public void reset(PluginCall call) {
        resetAudio();
        call.resolve(routeOnly(currentRoute(audioManager())));
    }

    @Override
    protected void handleOnDestroy() {
        try {
            resetAudio();
        } catch (Exception ignored) {
            // The bridge is going away; never throw from here.
        }
    }

    private JSObject routeOnly(String route) {
        JSObject result = new JSObject();
        result.put("route", route);
        return result;
    }

    private AudioManager audioManager() {
        try {
            Context context = getContext();
            if (context == null) return null;
            return (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String normalizeRoute(String route) {
        if (route == null) return null;
        String value = route.trim().toLowerCase(Locale.US);
        if (ROUTE_EARPIECE.equals(value)
                || ROUTE_SPEAKER.equals(value)
                || ROUTE_BLUETOOTH.equals(value)
                || ROUTE_HEADSET.equals(value)) {
            return value;
        }
        return null;
    }

    /** Applies the route. Never throws: on any failure the current route stays. */
    private void applyRoute(AudioManager audioManager, String route) {
        // Android 12+: Bluetooth SCO needs the BLUETOOTH_CONNECT runtime
        // permission. If the user has not granted it, keep the current route.
        if (ROUTE_BLUETOOTH.equals(route) && !hasBluetoothConnectPermission()) {
            return;
        }

        try {
            setCommunicationMode(audioManager);

            if (ROUTE_SPEAKER.equals(route)) {
                stopBluetoothSco(audioManager);
                audioManager.setSpeakerphoneOn(true);
            } else if (ROUTE_BLUETOOTH.equals(route)) {
                audioManager.setSpeakerphoneOn(false);
                startBluetoothSco(audioManager);
                audioManager.setBluetoothScoOn(true);
            } else if (ROUTE_HEADSET.equals(route)) {
                // Wired/USB headsets are selected by the system once the
                // speakerphone is off and SCO is not holding the output.
                stopBluetoothSco(audioManager);
                audioManager.setSpeakerphoneOn(false);
            } else {
                // Earpiece (and any unknown value): speaker off, SCO off.
                stopBluetoothSco(audioManager);
                audioManager.setSpeakerphoneOn(false);
            }
        } catch (SecurityException ignored) {
            // Missing permission: report the route that is still active.
        } catch (Exception ignored) {
            // Never throw across the bridge.
        }
    }

    private void setCommunicationMode(AudioManager audioManager) {
        try {
            if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            }
        } catch (Exception ignored) {
            // Some OEMs refuse mode changes; the route flags still apply.
        }
    }

    private String currentRoute(AudioManager audioManager) {
        if (audioManager == null) return ROUTE_EARPIECE;

        try {
            if (audioManager.isBluetoothScoOn()) return ROUTE_BLUETOOTH;
        } catch (Exception ignored) {
            // Treat as "not on Bluetooth".
        }

        try {
            if (audioManager.isSpeakerphoneOn()) return ROUTE_SPEAKER;
        } catch (Exception ignored) {
            // Fall through to headset/earpiece detection.
        }

        if (hasHeadset(audioManager)) return ROUTE_HEADSET;
        return ROUTE_EARPIECE;
    }

    /** True when an output device is (or can be) a Bluetooth headset. */
    private boolean bluetoothAvailable(AudioManager audioManager) {
        if (audioManager == null) return false;
        try {
            for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int type = device.getType();
                if (type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                        || type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) {
                    return true;
                }
            }
            return false;
        } catch (Exception ignored) {
            // Enumeration unavailable: fall back to the platform capability flag.
            try {
                return audioManager.isBluetoothScoAvailableOffCall();
            } catch (Exception ignoredToo) {
                return false;
            }
        }
    }

    /** True when a wired/USB headset is connected. */
    private boolean hasHeadset(AudioManager audioManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
        try {
            for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int type = device.getType();
                if (type == AudioDeviceInfo.TYPE_WIRED_HEADSET
                        || type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                        || type == AudioDeviceInfo.TYPE_USB_HEADSET) {
                    return true;
                }
            }
        } catch (Exception ignored) {
            // Some OEM audio stacks refuse device enumeration.
        }
        return false;
    }

    @SuppressWarnings("deprecation")
    private void startBluetoothSco(AudioManager audioManager) {
        try {
            audioManager.startBluetoothSco();
        } catch (Exception ignored) {
            // Deprecated on Android 12+; a SecurityException here is handled by
            // the caller reporting the still-active route.
        }
    }

    @SuppressWarnings("deprecation")
    private void stopBluetoothSco(AudioManager audioManager) {
        try {
            if (audioManager.isBluetoothScoOn()) {
                audioManager.setBluetoothScoOn(false);
            }
        } catch (Exception ignored) {
            // Not on SCO / no permission.
        }
        try {
            audioManager.stopBluetoothSco();
        } catch (Exception ignored) {
            // Already stopped.
        }
    }

    /** Restores normal audio mode and clears the call routing flags. */
    private void resetAudio() {
        AudioManager audioManager = audioManager();
        if (audioManager == null) return;

        try {
            audioManager.setSpeakerphoneOn(false);
        } catch (Exception ignored) {
            // Best effort.
        }
        stopBluetoothSco(audioManager);
        try {
            audioManager.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception ignored) {
            // Some OEMs refuse mode changes.
        }
    }

    /** BLUETOOTH_CONNECT exists as a runtime permission only on Android 12+. */
    private boolean hasBluetoothConnectPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        try {
            return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.BLUETOOTH_CONNECT)
                    == PackageManager.PERMISSION_GRANTED;
        } catch (Exception ignored) {
            return false;
        }
    }
}
