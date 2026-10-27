package app.chatgram.android;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

/**
 * Installed app version.
 *
 * Read from PackageManager instead of {@code BuildConfig}: this project does not
 * enable the {@code buildConfig} build feature, so that class is not generated.
 */
final class AppVersion {

    private AppVersion() {
    }

    static String name(Context context) {
        PackageInfo info = packageInfo(context);
        return info == null || info.versionName == null ? "0" : info.versionName;
    }

    static int code(Context context) {
        PackageInfo info = packageInfo(context);
        if (info == null) return 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return (int) info.getLongVersionCode();
        //noinspection deprecation
        return info.versionCode;
    }

    private static PackageInfo packageInfo(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
        } catch (PackageManager.NameNotFoundException ignored) {
            return null;
        }
    }
}
