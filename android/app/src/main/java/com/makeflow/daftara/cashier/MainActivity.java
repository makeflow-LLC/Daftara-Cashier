package com.makeflow.daftara.cashier;

import android.app.AlertDialog;
import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AppInfoPlugin.class);
        registerPlugin(InvoiceSharePlugin.class);
        for (Class<? extends Plugin> p : Flavor.plugins()) registerPlugin(p);
        super.onCreate(savedInstanceState);
        // نسخة معدّلة (أُعيد توقيعها بغير مفتاح MakeFlow): لا تعمل
        if (!Integrity.genuine(this)) {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().stopLoading();
                getBridge().getWebView().setVisibility(View.GONE);
            }
            new AlertDialog.Builder(this)
                .setTitle("نسخة غير أصلية")
                .setMessage("هذه النسخة من دفترة كاشير معدّلة ولا تعمل. نزّل النسخة الأصلية من MakeFlow — بياناتك تبقى محفوظة.")
                .setCancelable(false)
                .setPositiveButton("إغلاق", (d, w) -> finishAffinity())
                .show();
        }
    }
}
