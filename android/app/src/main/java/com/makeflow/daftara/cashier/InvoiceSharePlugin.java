package com.makeflow.daftara.cashier;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;

/**
 * يرسل ملف الفاتورة (صورة أو PDF): إلى محادثة الرقم في واتساب مباشرة إن أُعطي رقم،
 * أو إلى واتساب ليختار المستخدم المحادثة، وإن لم يوجد واتساب فقائمة المشاركة العادية.
 * الملف يُكتب في مجلد التخزين المؤقت للتطبيق ويُشارك عبر FileProvider (لا أذونات تخزين).
 */
@CapacitorPlugin(name = "InvoiceShare")
public class InvoiceSharePlugin extends Plugin {
    private static final String[] WHATSAPP = { "com.whatsapp", "com.whatsapp.w4b" };

    @PluginMethod
    public void share(PluginCall call) {
        String data = call.getString("data");
        String mime = call.getString("mime", "image/jpeg");
        String name = call.getString("name", "invoice.jpg").replaceAll("[^A-Za-z0-9._-]", "_");
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        if (data == null) { call.reject("no data"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "share");
            if (!dir.exists()) dir.mkdirs();
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) f.delete();
            File file = new File(dir, name);
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(Base64.decode(data, Base64.DEFAULT)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);

            boolean sent = false;
            for (String pkg : WHATSAPP) {
                Intent i = build(mime, uri, text);
                i.setPackage(pkg);
                if (phone != null && !phone.isEmpty()) i.putExtra("jid", phone + "@s.whatsapp.net");
                try { getActivity().startActivity(i); sent = true; break; } catch (ActivityNotFoundException e) { /* جرّب التالي */ }
            }
            if (!sent) getActivity().startActivity(Intent.createChooser(build(mime, uri, text), "إرسال الفاتورة"));
            JSObject r = new JSObject();
            r.put("whatsapp", sent);
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private Intent build(String mime, Uri uri, String text) {
        Intent i = new Intent(Intent.ACTION_SEND);
        i.setType(mime);
        i.putExtra(Intent.EXTRA_STREAM, uri);
        if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return i;
    }
}
