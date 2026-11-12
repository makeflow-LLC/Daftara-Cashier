# قواعد R8 لدفترة كاشير (direct و play).
# أعطال مقروءة في Play Console (ملف الخريطة يدخل في AAB)
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
# Capacitor يقرأ @CapacitorPlugin و @PluginMethod وقت التشغيل
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**
# إضافات التطبيق نفسه تبقى بأسمائها
-keep class com.makeflow.daftara.cashier.** { *; }
