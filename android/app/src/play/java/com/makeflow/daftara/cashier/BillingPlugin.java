package com.makeflow.daftara.cashier;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClient.BillingResponseCode;
import com.android.billingclient.api.BillingClient.ProductType;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * اشتراك دفترة كاشير عبر Google Play: منتجا اشتراك في Play Console
 * (cashier_monthly و cashier_yearly). الاشتراك الساري يبقى محفوظًا في المتجر فيُقرأ حتى بلا إنترنت.
 *
 * كل الدوال تُرجع (resolve) دائمًا: {ok, active, plan, token, pending, cancelled, prices:{monthly, yearly}, code, message}.
 *  - info: هل لصاحب الحساب اشتراك سارٍ؟ والأسعار بعملة بلده.
 *  - buy({plan: 'monthly'|'yearly'}): يفتح نافذة الدفع من Google.
 * ويُطلق حدث «purchase» حين يكتمل شراء.
 */
@CapacitorPlugin(name = "CashierBilling")
public class BillingPlugin extends Plugin implements PurchasesUpdatedListener {

    static final String MONTHLY = "cashier_monthly";
    static final String YEARLY = "cashier_yearly";

    private BillingClient client;
    private final Map<String, ProductDetails> details = new HashMap<>();
    private PluginCall buyCall;

    private interface Step { void run(); }

    @Override
    public void load() {
        client = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .build();
    }

    private void connect(PluginCall call, Step next) {
        if (client.isReady()) { next.run(); return; }
        client.startConnection(new BillingClientStateListener() {
            private boolean done;

            @Override
            public void onBillingSetupFinished(BillingResult r) {
                if (done) return;
                done = true;
                if (r.getResponseCode() == BillingResponseCode.OK) next.run();
                else fail(call, r);
            }

            @Override
            public void onBillingServiceDisconnected() {
                if (done) return;
                done = true;
                fail(call, null);
            }
        });
    }

    // تفاصيل المنتجين (الأسعار) مرة واحدة؛ لو تعذّرت نكمل بلا أسعار
    private void loadDetails(Step next) {
        if (!details.isEmpty()) { next.run(); return; }
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : new String[] { MONTHLY, YEARLY }) {
            products.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(ProductType.SUBS).build());
        }
        client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(products).build(), (r, result) -> {
            List<ProductDetails> list = result.getProductDetailsList();
            if (r.getResponseCode() == BillingResponseCode.OK && list != null) {
                for (ProductDetails d : list) details.put(d.getProductId(), d);
            }
            next.run();
        });
    }

    private ProductDetails.SubscriptionOfferDetails offer(String id) {
        ProductDetails d = details.get(id);
        if (d == null || d.getSubscriptionOfferDetails() == null || d.getSubscriptionOfferDetails().isEmpty()) return null;
        return d.getSubscriptionOfferDetails().get(0);
    }

    private String price(String id) {
        ProductDetails.SubscriptionOfferDetails o = offer(id);
        if (o == null) return null;
        List<ProductDetails.PricingPhase> phases = o.getPricingPhases().getPricingPhaseList();
        return phases.isEmpty() ? null : phases.get(phases.size() - 1).getFormattedPrice();
    }

    private JSObject prices() {
        JSObject p = new JSObject();
        p.put("monthly", price(MONTHLY));
        p.put("yearly", price(YEARLY));
        return p;
    }

    // حالة الاشتراك من قائمة المشتريات، مع تأكيد (acknowledge) أي شراء جديد،
    // وإلا تُرجع Google المبلغ تلقائيًا بعد 3 أيام
    private JSObject state(List<Purchase> purchases) {
        boolean active = false, pending = false;
        String plan = null, token = null;
        if (purchases != null) {
            for (Purchase p : purchases) {
                boolean yearly = p.getProducts().contains(YEARLY);
                if (!yearly && !p.getProducts().contains(MONTHLY)) continue;
                if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                    active = true;
                    if (plan == null || yearly) { plan = yearly ? "yearly" : "monthly"; token = p.getPurchaseToken(); }
                    if (!p.isAcknowledged()) {
                        client.acknowledgePurchase(
                            AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(),
                            r -> { });
                    }
                } else if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) {
                    pending = true;
                }
            }
        }
        JSObject o = new JSObject();
        o.put("ok", true);
        o.put("active", active);
        o.put("plan", plan);
        o.put("token", token);
        o.put("pending", pending && !active);
        o.put("prices", prices());
        return o;
    }

    private void fail(PluginCall call, BillingResult r) {
        if (call == null) return;
        JSObject o = new JSObject();
        o.put("ok", false);
        o.put("code", r == null ? BillingResponseCode.SERVICE_DISCONNECTED : r.getResponseCode());
        o.put("message", r == null ? "" : r.getDebugMessage());
        o.put("prices", prices());
        call.resolve(o);
    }

    @PluginMethod
    public void info(PluginCall call) {
        connect(call, () -> loadDetails(() -> client.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder().setProductType(ProductType.SUBS).build(),
            (r, purchases) -> {
                if (r.getResponseCode() != BillingResponseCode.OK) { fail(call, r); return; }
                call.resolve(state(purchases));
            })));
    }

    @PluginMethod
    public void buy(PluginCall call) {
        String id = "yearly".equals(call.getString("plan", "monthly")) ? YEARLY : MONTHLY;
        connect(call, () -> loadDetails(() -> {
            ProductDetails d = details.get(id);
            ProductDetails.SubscriptionOfferDetails o = offer(id);
            if (d == null || o == null) {
                JSObject res = new JSObject();
                res.put("ok", false);
                res.put("code", BillingResponseCode.ITEM_UNAVAILABLE);
                res.put("message", "product details unavailable");
                call.resolve(res);
                return;
            }
            List<BillingFlowParams.ProductDetailsParams> list = new ArrayList<>();
            list.add(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(d).setOfferToken(o.getOfferToken()).build());
            BillingFlowParams params = BillingFlowParams.newBuilder().setProductDetailsParamsList(list).build();
            getActivity().runOnUiThread(() -> {
                buyCall = call;
                BillingResult r = client.launchBillingFlow(getActivity(), params);
                if (r.getResponseCode() != BillingResponseCode.OK) {
                    buyCall = null;
                    fail(call, r);
                }
            });
        }));
    }

    @Override
    public void onPurchasesUpdated(BillingResult r, List<Purchase> purchases) {
        PluginCall call = buyCall;
        buyCall = null;
        int code = r.getResponseCode();
        if (code == BillingResponseCode.OK) {
            JSObject o = state(purchases);
            notifyListeners("purchase", o);
            if (call != null) call.resolve(o);
        } else if (code == BillingResponseCode.USER_CANCELED) {
            if (call != null) {
                JSObject o = new JSObject();
                o.put("ok", true);
                o.put("cancelled", true);
                call.resolve(o);
            }
        } else if (code == BillingResponseCode.ITEM_ALREADY_OWNED) {
            if (call != null) info(call);
        } else {
            fail(call, r);
        }
    }
}
