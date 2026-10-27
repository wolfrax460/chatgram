package app.chatgram.android;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;

/** Small helpers for the downloaded APK: hash verification and cleanup. */
final class UpdateFile {

    private UpdateFile() {
    }

    /** SHA-256 of a file as lowercase hex, or null on error. */
    static String sha256(File file) {
        if (file == null || !file.isFile()) return null;
        InputStream input = null;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            input = new FileInputStream(file);
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) digest.update(buffer, 0, read);
            byte[] bytes = digest.digest();
            StringBuilder hex = new StringBuilder(bytes.length * 2);
            for (byte value : bytes) hex.append(String.format("%02x", value));
            return hex.toString();
        } catch (Exception ignored) {
            return null;
        } finally {
            try {
                if (input != null) input.close();
            } catch (Exception ignored) {
                // nothing to do
            }
        }
    }

    /**
     * Verify the downloaded APK against the SHA-256 the server published.
     * A mismatch deletes the file: never offer to install something we cannot
     * tie to the release we were told about.
     */
    static boolean verify(File file, String expectedSha256) {
        if (expectedSha256 == null || expectedSha256.trim().isEmpty()) return false;
        String actual = sha256(file);
        boolean ok = actual != null && actual.equalsIgnoreCase(expectedSha256.trim());
        if (!ok && file != null && file.isFile()) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
        return ok;
    }
}
