package com.makeflow.daftara.cashier;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * قفل التطبيق بالبصمة: نافذة النظام (بصمة أو وجه)، وبديلها رمز قفل الجوال (PIN / نقش / كلمة سر)
 * فلا يُحبس صاحب المحل خارج تطبيقه إن لم تُقرأ بصمته. لا تُحفظ أي بصمة في التطبيق: النظام يتحقق ويجيب بنعم أو لا.
 */
@CapacitorPlugin(name = "Biometric")
public class BiometricPlugin extends Plugin {
    private static final int BIOMETRIC = BiometricManager.Authenticators.BIOMETRIC_WEAK;
    private static final int ANY = BIOMETRIC | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        try {
            BiometricManager m = BiometricManager.from(getContext());
            r.put("available", m.canAuthenticate(ANY) == BiometricManager.BIOMETRIC_SUCCESS);
            r.put("biometric", m.canAuthenticate(BIOMETRIC) == BiometricManager.BIOMETRIC_SUCCESS);
        } catch (Exception e) {
            r.put("available", false);
            r.put("biometric", false);
        }
        call.resolve(r);
    }

    @PluginMethod
    public void authenticate(final PluginCall call) {
        final FragmentActivity activity = getActivity();
        if (activity == null) { call.reject("no activity"); return; }
        final String title = call.getString("title", "دفترة كاشير");
        final String subtitle = call.getString("subtitle", "");
        activity.runOnUiThread(() -> {
            try {
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setAllowedAuthenticators(ANY)
                    .setConfirmationRequired(false)
                    .build();
                BiometricPrompt prompt = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            call.resolve(new JSObject().put("ok", true));
                        }

                        @Override
                        public void onAuthenticationError(int code, @NonNull CharSequence message) {
                            call.reject(message.toString(), String.valueOf(code));
                        }
                    });
                prompt.authenticate(info);
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }
}
