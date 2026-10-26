# Chatgram Android (Capacitor shell) - R8 rules
#
# The release build enables R8 (minifyEnabled true) + resource shrinking.
# Capacitor reaches the Java side from JavaScript through annotated classes and
# @JavascriptInterface methods, which R8 would otherwise rename or strip.

# The whole Capacitor runtime, its plugins and annotations.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }

# Anything the WebView calls back into (bridge message handlers).
-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Cordova compatibility layer (present but unused by Chatgram) and its providers.
-keep class org.apache.cordova.** { *; }

# Keep the launcher activity name for readable crash reports.
-keepnames class app.chatgram.android.MainActivity

# AndroidX WebKit / Cordova optional dependencies that are not on the classpath.
-dontwarn androidx.webkit.**
-dontwarn org.apache.cordova.**
