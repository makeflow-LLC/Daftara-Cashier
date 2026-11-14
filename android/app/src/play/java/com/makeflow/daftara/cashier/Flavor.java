package com.makeflow.daftara.cashier;

import com.getcapacitor.Plugin;
import java.util.Collections;
import java.util.List;

/** نسخة Google Play: الاشتراك عبر Google Play Billing. */
final class Flavor {
    private Flavor() { }

    static List<Class<? extends Plugin>> plugins() {
        return Collections.<Class<? extends Plugin>>singletonList(BillingPlugin.class);
    }
}
