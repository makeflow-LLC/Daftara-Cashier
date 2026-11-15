package com.makeflow.daftara.cashier;

import com.getcapacitor.Plugin;
import java.util.Collections;

import java.util.List;

/** نسخة التوزيع المباشر (APK): التفعيل بكود موقَّع من MakeFlow، وإرسال SMS للزبائن (اختياري). */
final class Flavor {
    private Flavor() { }

    static List<Class<? extends Plugin>> plugins() {
        return Collections.<Class<? extends Plugin>>singletonList(SmsPlugin.class);
    }
}
