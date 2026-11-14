package com.makeflow.daftara.cashier;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.provider.Settings;
import java.security.MessageDigest;

/**
 * حماية الترخيص من جهة أندرويد (لا من صفحات التطبيق التي يسهل تعديلها):
 *  - genuine: هل هذا الـ APK موقَّع بمفتاح MakeFlow؟ من يعدّل الكود داخل الـ APK يضطر لإعادة توقيعه
 *    بمفتاح آخر، فيختلف التوقيع عن البصمة المحفوظة وقت البناء (BuildConfig.CERT_SHA256) ويرفض التطبيق العمل.
 *    نسخة Google Play لا تُفحص هنا: المتجر يعيد توقيعها بمفتاحه، وهو نفسه يمنع تثبيت نسخة معدّلة كتحديث.
 *  - deviceKey: بصمة ثابتة للجهاز (تبقى بعد حذف التطبيق وإعادة تثبيته) يُربط بها كود التفعيل والتجربة.
 */
final class Integrity {
    private Integrity() { }

    static boolean genuine(Context c) {
        String want = BuildConfig.CERT_SHA256;
        if (BuildConfig.DEBUG || want == null || want.isEmpty()) return true;
        try {
            PackageManager pm = c.getPackageManager();
            Signature[] sigs;
            if (Build.VERSION.SDK_INT >= 28) {
                PackageInfo pi = pm.getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                sigs = pi.signingInfo.hasMultipleSigners()
                    ? pi.signingInfo.getApkContentsSigners()
                    : pi.signingInfo.getSigningCertificateHistory();
            } else {
                sigs = pm.getPackageInfo(c.getPackageName(), PackageManager.GET_SIGNATURES).signatures;
            }
            if (sigs == null || sigs.length == 0) return false;
            for (Signature s : sigs) if (want.equalsIgnoreCase(sha256(s.toByteArray()))) return true;
            return false;
        } catch (Exception e) {
            return true; // خطأ غير متوقع في النظام: لا نقفل تطبيقًا سليمًا
        }
    }

    static String deviceKey(Context c) {
        try {
            String id = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ANDROID_ID);
            if (id == null || id.isEmpty()) return null;
            return sha256(("cashier|" + id).getBytes("UTF-8")).substring(0, 32);
        } catch (Exception e) {
            return null;
        }
    }

    static long installedAt(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).firstInstallTime;
        } catch (Exception e) {
            return 0;
        }
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }
}
