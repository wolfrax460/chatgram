package app.chatgram.android;

import android.app.DownloadManager;
import android.content.Context;
import android.database.Cursor;

import java.io.File;

/**
 * Finalises a finished update download.
 *
 * Why this is not just a BroadcastReceiver: since Android 8 an app cannot receive
 * most implicit broadcasts in a manifest-declared receiver, so
 * {@code ACTION_DOWNLOAD_COMPLETE} is unreliable there (the emulator proved it:
 * the file arrived but the state stayed "available"). The same logic is therefore
 * reachable from three places:
 *
 *  1. a context-registered receiver while the app is running,
 *  2. a WorkManager job (runs even when the app is closed),
 *  3. lazily from {@code getState()}, so merely opening the app finishes the job.
 *
 * It always verifies the SHA-256 before marking the update "ready"; a mismatch
 * deletes the file.
 */
final class UpdateFinalizer {

    private UpdateFinalizer() {
    }

    enum Result { NONE, RUNNING, READY, FAILED }

    /** Inspect the recorded request and finish it if it is terminal. */
    static Result finalizeIfComplete(Context context) {
        long requestId = UpdatePrefs.requestId(context);
        if (requestId <= 0) return Result.NONE;

        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return Result.NONE;

        int status = -1;
        int reason = 0;
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(requestId))) {
            if (cursor == null || !cursor.moveToFirst()) return Result.FAILED;
            status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
        } catch (Exception ignored) {
            return Result.NONE;
        }

        if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PAUSED
                || status == DownloadManager.STATUS_PENDING) {
            return Result.RUNNING;
        }

        if (status == DownloadManager.STATUS_SUCCESSFUL) {
            File apk = UpdatePaths.downloadedFile(context);
            if (apk == null || !apk.isFile()) {
                UpdatePrefs.setError(context, "The download finished but the file is missing.");
                return Result.FAILED;
            }
            if (!UpdateFile.verify(apk, UpdatePrefs.expectedSha256(context))) {
                UpdatePrefs.setError(context, "The downloaded update failed its checksum and was removed.");
                return Result.FAILED;
            }
            UpdatePrefs.setReady(context, apk.getAbsolutePath(), apk.length());
            UpdateNotifier.notifyReady(context, UpdatePrefs.version(context));
            return Result.READY;
        }

        UpdatePrefs.setError(context, describeFailure(reason));
        return Result.FAILED;
    }

    private static String describeFailure(int reason) {
        switch (reason) {
            case DownloadManager.ERROR_INSUFFICIENT_SPACE:
                return "Not enough free space to download the update.";
            case DownloadManager.ERROR_FILE_ERROR:
                return "The update file could not be written.";
            case DownloadManager.ERROR_CANNOT_RESUME:
            case DownloadManager.ERROR_UNHANDLED_HTTP_CODE:
                return "The update download was interrupted. Try again on a better connection.";
            default:
                return "The update download failed. Try again.";
        }
    }
}
