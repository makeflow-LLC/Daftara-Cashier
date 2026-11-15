package com.makeflow.daftara.cashier;

import android.Manifest;
import android.content.Context;
import android.os.Build;
import android.telephony.SmsManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/**
 * يرسل رسالة SMS للزبون من شريحة الجوال (على رصيد صاحب المحل)، بلا فتح تطبيق الرسائل.
 * لا يعمل إلا بعد أن يشغّل صاحب المحل الميزة ويوافق على الإذن.
 *  - status: {granted}
 *  - request: يطلب الإذن → {granted}
 *  - send({phone, text}): يرسل (يقسم الرسالة الطويلة أجزاء) → {ok, parts}
 */
@CapacitorPlugin(name = "CashierSms", permissions = { @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }) })
public class SmsPlugin extends Plugin {

    private boolean granted() {
        return getPermissionState("sms") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", granted());
        call.resolve(r);
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (granted()) { status(call); return; }
        requestPermissionForAlias("sms", call, "afterRequest");
    }

    @PermissionCallback
    private void afterRequest(PluginCall call) {
        status(call);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        if (!granted()) { call.reject("no permission"); return; }
        if (phone == null || !phone.matches("^\\+?[0-9]{7,15}$") || text == null || text.isEmpty()) { call.reject("bad input"); return; }
        try {
            SmsManager sms = Build.VERSION.SDK_INT >= 31
                ? getContext().getSystemService(SmsManager.class)
                : SmsManager.getDefault();
            ArrayList<String> parts = sms.divideMessage(text);
            String to = phone.startsWith("+") ? phone : "+" + phone;
            if (parts.size() > 1) sms.sendMultipartTextMessage(to, null, parts, null, null);
            else sms.sendTextMessage(to, null, text, null, null);
            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("parts", parts.size());
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }
}
