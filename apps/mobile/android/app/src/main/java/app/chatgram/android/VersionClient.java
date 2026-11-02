package app.chatgram.android;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/**
 * Talks to {@code GET /api/app/version} and decides whether an update applies.
 *
 * <p>DOMAIN MOVE: old host keeps working; next build switches the default to
 * https://chatgram.qd.je. Both hosts are allowed, and the request tries the new
 * host first with the old host as fallback (see {@link Sites#API_BASES}).
 *
 * Kept free of Android UI types so the rules are easy to read and reason about:
 *  - the download URL must be on one of OUR HTTPS hosts (never a third party),
 *  - a withdrawn build is never offered,
 *  - an older or equal version is never offered (no downgrades),
 *  - {@code minSupportedVersion} / {@code forceUpdate} turn an update into a
 *    required one (blocking screen).
 */
final class VersionClient {

    /** Our own hosts. Anything else is refused before DownloadManager sees it. */
    private static final Set<String> ALLOWED_HOSTS = new HashSet<>(Arrays.asList(
            Sites.HOST_NEW,
            Sites.HOST_OLD,
            "chatgram.duckdns.org"
    ));

    private static final int TIMEOUT_MS = 12_000;

    private VersionClient() {
    }

    static final class Info {
        String latestVersion = "";
        int versionCode = 0;
        String url = "";
        String sha256 = "";
        long size = 0;
        String notes = "";
        String minSupportedVersion = "";
        boolean forceUpdate = false;
        boolean withdrawn = false;
    }

    /** What the app should do about the answer. */
    enum Action { NONE, OPTIONAL, REQUIRED }

    static Action decide(Info info, String installedVersion, int installedCode) {
        if (info == null || info.withdrawn) return Action.NONE;
        if (info.url == null || info.url.isEmpty()) return Action.NONE;
        if (!isAllowedUrl(info.url)) return Action.NONE;
        if (!isNewer(info, installedVersion, installedCode)) return Action.NONE;

        if (info.forceUpdate) return Action.REQUIRED;
        if (info.minSupportedVersion != null && !info.minSupportedVersion.isEmpty()
                && compareVersions(installedVersion, info.minSupportedVersion) < 0) {
            return Action.REQUIRED;
        }
        return Action.OPTIONAL;
    }

    static boolean isNewer(Info info, String installedVersion, int installedCode) {
        if (info.versionCode > 0 && installedCode > 0 && info.versionCode > installedCode) return true;
        return compareVersions(info.latestVersion, installedVersion) > 0;
    }

    /** Compare dotted numeric versions; missing parts count as zero. */
    static int compareVersions(String a, String b) {
        String[] left = String.valueOf(a == null ? "0" : a).split("[.-]");
        String[] right = String.valueOf(b == null ? "0" : b).split("[.-]");
        for (int i = 0; i < 3; i += 1) {
            int l = i < left.length ? parseIntOrZero(left[i]) : 0;
            int r = i < right.length ? parseIntOrZero(right[i]) : 0;
            if (l != r) return l > r ? 1 : -1;
        }
        return 0;
    }

    private static int parseIntOrZero(String value) {
        try {
            return Integer.parseInt(value.trim());
        } catch (Exception ignored) {
            return 0;
        }
    }

    /** HTTPS on one of our hosts only. */
    static boolean isAllowedUrl(String raw) {
        if (raw == null) return false;
        try {
            URL parsed = new URL(raw);
            if (!"https".equalsIgnoreCase(parsed.getProtocol())) return false;
            String host = parsed.getHost();
            return host != null && ALLOWED_HOSTS.contains(host.toLowerCase());
        } catch (Exception ignored) {
            return false;
        }
    }

    static Info fetch(String currentVersion, int currentCode) throws IOException, JSONException {
        // DOMAIN MOVE: the new host is tried first, the old host is the fallback,
        // so a next build works after the switch while today's deployment still
        // answers. Timeouts are per attempt and unchanged.
        IOException ioFailure = null;
        JSONException jsonFailure = null;
        for (String apiBase : Sites.API_BASES) {
            try {
                return fetchFrom(apiBase, currentVersion, currentCode);
            } catch (IOException error) {
                ioFailure = error;
            } catch (JSONException error) {
                jsonFailure = error;
            }
        }
        if (ioFailure != null) throw ioFailure;
        if (jsonFailure != null) throw jsonFailure;
        throw new IOException("version endpoint unreachable");
    }

    private static Info fetchFrom(String apiBase, String currentVersion, int currentCode)
            throws IOException, JSONException {
        String endpoint = apiBase + "/api/app/version?platform=android"
                + "&current=" + urlEncode(currentVersion)
                + "&build=" + currentCode;
        HttpURLConnection connection = null;
        try {
            URL url = new URL(endpoint);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "ChatgramAndroid-updater");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) {
                throw new IOException("version endpoint returned HTTP " + status);
            }
            String body = readAll(connection.getInputStream());
            JSONObject json = new JSONObject(body);
            Info info = new Info();
            info.latestVersion = json.optString("latestVersion", "");
            info.versionCode = json.optInt("versionCode", 0);
            info.url = json.optString("url", "");
            info.sha256 = json.optString("sha256", "");
            info.size = json.optLong("size", 0);
            info.notes = json.optString("notes", "");
            info.minSupportedVersion = json.optString("minSupportedVersion", "");
            info.forceUpdate = json.optBoolean("forceUpdate", false);
            info.withdrawn = json.optBoolean("withdrawn", false);
            return info;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String urlEncode(String value) {
        try {
            return java.net.URLEncoder.encode(value == null ? "0" : value, StandardCharsets.UTF_8.name());
        } catch (Exception ignored) {
            return "0";
        }
    }

    private static String readAll(InputStream stream) throws IOException {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
        }
        return builder.toString();
    }
}
