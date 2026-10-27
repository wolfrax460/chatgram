package app.chatgram.android;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * Finishes an update download while the app is closed.
 *
 * The DownloadManager notification means the transfer is running; this job wakes
 * shortly afterwards, verifies the SHA-256 of the file and posts "Update ready:
 * tap to install". It retries with backoff while the download is still running
 * and gives up after a bounded number of attempts (the plugin also finalises
 * lazily when the app is opened, so nothing is lost).
 */
public class UpdateFinalizeWorker extends Worker {

    private static final String NAME = "chatgram-update-finalize";
    private static final int MAX_ATTEMPTS = 12;

    public UpdateFinalizeWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        if (UpdatePrefs.requestId(context) <= 0) return Result.success();

        UpdateFinalizer.Result result = UpdateFinalizer.finalizeIfComplete(context);
        if (result == UpdateFinalizer.Result.RUNNING && getRunAttemptCount() < MAX_ATTEMPTS) {
            return Result.retry();
        }
        return Result.success();
    }

    /** Ask for a finalisation pass ~8 s after the download was enqueued. */
    static void schedule(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UpdateFinalizeWorker.class)
                .setInitialDelay(8, TimeUnit.SECONDS)
                .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.NOT_REQUIRED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build();
        WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, request);
    }
}
