package com.makeflow.daftara.cashier;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** يخبر صفحة التطبيق بنوع النسخة (direct أو play) ورقم البناء، فتعرض وحدة التفعيل المناسبة. */
@CapacitorPlugin(name = "AppInfo")
public class AppInfoPlugin extends Plugin {
    @PluginMethod
    public void get(PluginCall call) {
        JSObject r = new JSObject();
        r.put("flavor", BuildConfig.FLAVOR);
        r.put("versionCode", BuildConfig.VERSION_CODE);
        r.put("versionName", BuildConfig.VERSION_NAME);
        r.put("sdk", android.os.Build.VERSION.SDK_INT);
        call.resolve(r);
    }
}
