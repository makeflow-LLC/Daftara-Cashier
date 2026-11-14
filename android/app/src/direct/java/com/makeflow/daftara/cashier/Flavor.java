package com.makeflow.daftara.cashier;

import com.getcapacitor.Plugin;
import java.util.Collections;
import java.util.List;

/** نسخة التوزيع المباشر (APK): التفعيل بكود موقَّع من MakeFlow، فلا إضافات خاصة بالمتجر. */
final class Flavor {
    private Flavor() { }

    static List<Class<? extends Plugin>> plugins() {
        return Collections.emptyList();
    }
}
