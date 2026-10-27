package app.chatgram.android;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * Background update check (chunk 7C).
 *
 * Runs roughly every 12 hours so a check happens within 24 hours even when the
 * app is never opened — as long as the system lets the job run (Doze/battery
 * optimisations can delay it; the in-app checks are the fast path).
 *
 * Network: {@code CONNECTED} rather than {@code UNMETERED}, because the owner
 * decision is that updates may download over Wi-Fi **or mobile data** — the
 * download itself still honours the user's "Wi-Fi only" preference.
 */
public class UpdateWorker extends Worker {

    private static final String PERIODIC_NAME = "chatgram-update-check";
    private static final String ONCE_NAME = "chatgram-update-check-now";

    public UpdateWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        try {
            VersionClient.Info info = VersionClient.fetch(AppVersion.name(context), AppVersion.code(context));
            UpdatePrefs.setChecked(context);
            VersionClient.Action action = VersionClient.decide(info, AppVersion.name(context), AppVersion.code(context));
            if (action == VersionClient.Action.NONE) {
                // Nothing to do; leave any "ready" state alone.
                return Result.success();
            }
            boolean required = action == VersionClient.Action.REQUIRED;
            UpdatePrefs.setAvailable(context, info, required);
            if (!UpdateDownloader.networkAvailable(context)) {
                // Constraint should prevent this, but a metered-only device with
                // "Wi-Fi only" on lands here; retry later instead of failing.
                return Result.retry();
            }
            UpdateDownloader.enqueue(context);
            UpdateFinalizeWorker.schedule(context);
            return Result.success();
        } catch (Exception error) {
            return Result.retry();
        }
    }

    static Constraints connected() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    /** ~12 h periodic check; keeps one unique job. */
    static void schedulePeriodic(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(UpdateWorker.class, 12, TimeUnit.HOURS)
                .setConstraints(connected())
                .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                PERIODIC_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
        );
    }

    /** One check now (app start, or after the user taps "Check for updates"). */
    static void checkNow(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(UpdateWorker.class)
                .setConstraints(connected())
                .build();
        WorkManager.getInstance(context).enqueueUniqueWork(ONCE_NAME, ExistingWorkPolicy.REPLACE, request);
    }
}
