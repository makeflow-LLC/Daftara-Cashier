package com.makeflow.daftara.cashier;

import android.Manifest;
import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.util.UUID;

/**
 * طابعة الفواتير الحرارية عبر بلوتوث (58 أو 80 ملم، أوامر ESC/POS). الصفحة ترسم الفاتورة صورةً
 * (فالعربية سليمة على أي طابعة) وتحوّلها إلى أوامر طباعة، وهذه الإضافة ترسلها فقط.
 * نستعمل الطابعات المقترنة في إعدادات بلوتوث بالجوال فقط: لا بحث عن أجهزة، فلا إذن موقع.
 *  - list(): الأجهزة المقترنة → {devices: [{name, address, major}]}
 *  - print({address, data (base64)}): يتصل ويرسل ويغلق
 */
@CapacitorPlugin(name = "ThermalPrinter", permissions = { @Permission(alias = "bt", strings = { Manifest.permission.BLUETOOTH_CONNECT }) })
public class ThermalPrinterPlugin extends Plugin {
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    /** قبل أندرويد 12 إذن بلوتوث يُعطى عند التثبيت. */
    private boolean granted() {
        return Build.VERSION.SDK_INT < 31 || getPermissionState("bt") == PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m != null ? m.getAdapter() : null;
    }

    @PluginMethod
    public void list(PluginCall call) {
        if (!granted()) { requestPermissionForAlias("bt", call, "afterPermission"); return; }
        doList(call);
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (!granted()) { requestPermissionForAlias("bt", call, "afterPermission"); return; }
        doPrint(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (!granted()) { call.reject("no permission", "PERMISSION"); return; }
        if ("print".equals(call.getMethodName())) doPrint(call);
        else doList(call);
    }

    @SuppressLint("MissingPermission")
    private void doList(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null) { call.reject("no bluetooth", "NO_BT"); return; }
        if (!a.isEnabled()) { call.reject("bluetooth off", "BT_OFF"); return; }
        JSArray arr = new JSArray();
        for (BluetoothDevice d : a.getBondedDevices()) {
            JSObject o = new JSObject();
            o.put("name", d.getName() != null ? d.getName() : d.getAddress());
            o.put("address", d.getAddress());
            BluetoothClass c = d.getBluetoothClass();
            o.put("major", c != null ? c.getMajorDeviceClass() : -1);
            arr.put(o);
        }
        JSObject r = new JSObject();
        r.put("devices", arr);
        call.resolve(r);
    }

    @SuppressLint("MissingPermission")
    private void doPrint(PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || data == null || !BluetoothAdapter.checkBluetoothAddress(address)) { call.reject("bad input"); return; }
        final BluetoothAdapter a = adapter();
        if (a == null) { call.reject("no bluetooth", "NO_BT"); return; }
        if (!a.isEnabled()) { call.reject("bluetooth off", "BT_OFF"); return; }
        final byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        // الاتصال يحجب حتى ثوانٍ: خارج خيط الواجهة
        new Thread(() -> {
            BluetoothSocket s = null;
            try {
                BluetoothDevice d = a.getRemoteDevice(address);
                s = d.createRfcommSocketToServiceRecord(SPP);
                try {
                    s.connect();
                } catch (IOException first) {
                    // بعض الطابعات الرخيصة تقبل الاتصال غير الآمن فقط
                    try { s.close(); } catch (IOException ignored) { }
                    s = d.createInsecureRfcommSocketToServiceRecord(SPP);
                    s.connect();
                }
                OutputStream out = s.getOutputStream();
                // أجزاء صغيرة: ذاكرة الطابعات الرخيصة محدودة
                for (int i = 0; i < bytes.length; i += 512) {
                    out.write(bytes, i, Math.min(512, bytes.length - i));
                    out.flush();
                    Thread.sleep(15);
                }
                Thread.sleep(400);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "print failed", "PRINT_FAILED");
            } finally {
                if (s != null) try { s.close(); } catch (IOException ignored) { }
            }
        }).start();
    }
}
