package app.chatgram.android;

import android.app.DownloadManager;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;

import java.io.File;

/**
 * Enqueues the update download with Android's DownloadManager.
 *
 * Network policy (owner requirement): the update may download over **Wi-Fi or
 * mobile data — whichever is available**. Only when the user turns on "Wi-Fi
 * only" (to save data) does the request require an unmetered connection. Roaming
 * is left off so a trip cannot quietly cost money.
 */
final class UpdateDownloader {

    private UpdateDownloader() {
    }

    /**
     * True when an update may be fetched right now. Default = any usable network
     * (Wi-Fi, mobile data, ethernet); Wi-Fi-only mode requires Wi-Fi.
     */
    static boolean networkAvailable(Context context) {
        boolean wifiOnly = UpdatePrefs.isWifiOnly(context);
        ConnectivityManager manager = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        Network active = manager.getActiveNetwork();
        if (active == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(active);
        if (capabilities == null) return false;
        if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) return false;
        if (wifiOnly) return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
        // Any route works: Wi-Fi, cellular or ethernet.
        return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
                || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET);
    }

    static String fileNameFor(String version) {
        String safe = (version == null ? "update" : version).replaceAll("[^0-9A-Za-z._-]", "_");
        return "chatgram-" + safe + ".apk";
    }

    /**
     * Start the download for the version recorded in prefs.
     * @return the DownloadManager request id.
     * @throws Exception when the URL is not ours or the request cannot be made.
     */
    static long enqueue(Context context) throws Exception {
        String url = UpdatePrefs.url(context);
        if (url == null || url.isEmpty()) throw new Exception("No update has been selected. Check for updates first.");
        if (!VersionClient.isAllowedUrl(url)) throw new Exception("Refusing an update from an untrusted host.");
        if (!networkAvailable(context)) {
            throw new Exception(UpdatePrefs.isWifiOnly(context)
                    ? "Waiting for Wi-Fi (Wi-Fi only is on)."
                    : "No internet connection right now.");
        }

        String state = UpdatePrefs.state(context);
        if (("downloading".equals(state) || "ready".equals(state)) && UpdatePrefs.requestId(context) > 0) {
            throw new Exception("An update download is already running.");
        }

        UpdatePaths.clearDownloads(context);
        File dir = UpdatePaths.directory(context);
        String fileName = fileNameFor(UpdatePrefs.version(context));
        File target = new File(dir, fileName);
        if (target.exists()) {
            //noinspection ResultOfMethodCallIgnored
            target.delete();
        }

        // Cache-bust per version: /downloads/ is behind a CDN with a 1 h TTL, and a
        // same-URL fetch can return the PREVIOUS APK (the emulator test proved it:
        // the file arrived with the old size and the SHA-256 check correctly
        // refused it). A version query is a distinct cache key, so every release
        // starts from the real file.
        Uri downloadUri = Uri.parse(url);
        if (downloadUri.getQueryParameter("v") == null) {
            downloadUri = downloadUri.buildUpon().appendQueryParameter("v", UpdatePrefs.version(context)).build();
        }
        DownloadManager.Request request = new DownloadManager.Request(downloadUri);
        request.setTitle("Chatgram update");
        request.setDescription("Downloading Chatgram " + UpdatePrefs.version(context));
        request.setMimeType("application/vnd.android.package-archive");
        request.setDestinationInExternalFilesDir(context, null, "updates/" + fileName);
        // The delivered file must be visible to this app immediately.
        request.setAllowedOverMetered(!UpdatePrefs.isWifiOnly(context));
        request.setAllowedOverRoaming(false);
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE);
        request.setVisibleInDownloadsUi(false);

        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) throw new Exception("The system download service is unavailable.");
        long id = manager.enqueue(request);
        if (id <= 0) throw new Exception("The download could not be started.");
        UpdatePrefs.setDownloading(context, id, target.getAbsolutePath());
        return id;
    }
}
