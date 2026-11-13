#!/usr/bin/env bash
# اختبار دخان على محاكي أندرويد (من .github/workflows/android.yml):
# يثبّت الـ APK، يقيس زمن الفتح، يمر بالإعداد الأول، ويفتح شاشة البيع من الزر العائم.
set -euo pipefail
PKG=com.makeflow.daftara.cashier
on_exit() {
  adb exec-out screencap -p > screenshot.png || true
  echo "--- on screen:"; grep -o 'text="[^"]*"' ui.xml 2>/dev/null | sort -u | head -40 || true
  echo "--- logcat:"; adb logcat -d | grep -iE "Capacitor|chromium|FATAL|AndroidRuntime" | tail -n 60 || true
}
trap on_exit EXIT

dump() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb shell cat /sdcard/ui.xml > ui.xml 2>/dev/null || true
}

# يضغط على أول عنصر نصّه (أو وصفه) يحتوي $1، كما يراه UiAutomator داخل الـ WebView
tap() {
  for _ in $(seq 1 15); do
    dump
    xy=$(python3 - "$1" <<'PY'
import re, sys
xml = open('ui.xml', encoding='utf-8', errors='ignore').read()
want = sys.argv[1]
exact, partial = [], []
for node in re.findall(r'<node [^>]*>', xml):
    t = re.search(r' text="([^"]*)"', node); d = re.search(r'content-desc="([^"]*)"', node)
    labels = ((t.group(1) if t else ''), (d.group(1) if d else ''))
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
    if not b: continue
    x1, y1, x2, y2 = map(int, b.groups())
    if x2 <= x1 or y2 <= y1: continue
    hit = ((x1 + x2) // 2, (y1 + y2) // 2)
    if want in labels: exact.append(hit)
    elif any(want in l for l in labels): partial.append(hit)
for x, y in exact[:1] or partial[:1]:
    print(x, y)
PY
)
    if [ -n "$xy" ]; then echo "tap '$1' at $xy"; adb shell input tap $xy; return 0; fi
    sleep 2
  done
  echo "::error::'$1' not found on screen"; return 1
}

# يضغط أول حقل كتابة (EditText) على الشاشة — حقول WebView قد لا تظهر بنصها في UiAutomator
tap_edit() {
  for _ in $(seq 1 10); do
    dump
    xy=$(python3 - <<'PY'
import re
xml = open('ui.xml', encoding='utf-8', errors='ignore').read()
for node in re.findall(r'<node [^>]*>', xml):
    if 'class="android.widget.EditText"' not in node: continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
    if not b: continue
    x1, y1, x2, y2 = map(int, b.groups())
    if x2 > x1 and y2 > y1:
        print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
    if [ -n "$xy" ]; then echo "tap edit at $xy"; adb shell input tap $xy; return 0; fi
    sleep 2
  done
  echo "::error::no text field on screen"; return 1
}

expect() {
  for _ in $(seq 1 10); do dump; grep -q "$1" ui.xml && { echo "OK: $1"; return 0; }; sleep 2; done
  echo "::error::'$1' not on screen"; return 1
}

hide_kb() {
  sleep 1
  if adb shell dumpsys input_method | grep -q 'mInputShown=true'; then adb shell input keyevent 4; sleep 1; fi
}

adb install -r daftara-cashier.apk
# الكاميرا تُطلب عند فتح شاشة البيع؛ نمنحها مسبقًا حتى لا تقف نافذة الإذن أمام الاختبار
adb shell pm grant $PKG android.permission.CAMERA || true
echo "--- cold start:"
adb shell am start -W -n $PKG/.MainActivity | tee start.txt
echo "COLD_START_MS=$(grep -o 'TotalTime: [0-9]*' start.txt | grep -o '[0-9]*')"
sleep 6

# 1) الإعداد الأول: اسم المحل ثم النوع (المحاكي قد يتأخر في أول تشغيل للـ WebView: ننتظر حتى دقيقة)
expect 'أهلًا بك في دفترة كاشير' || { sleep 20; expect 'أهلًا بك في دفترة كاشير'; }
tap 'اسم المحل' || true
adb shell input text 'Shop1'
hide_kb
tap 'التالي'
expect 'ما نوع محلك'
tap 'بقالة'

# 2) الرئيسية
expect 'مبيعات اليوم'
expect 'Shop1'

# 3) شاشة البيع من الزر العائم
tap 'بيع جديد'
expect 'السلة فارغة'
adb shell input keyevent 4
expect 'مبيعات اليوم'

# 4) إضافة سريعة بالمسح (بالكتابة اليدوية: المحاكي بلا باركود حقيقي أمام الكاميرا)
tap 'الأصناف'
expect 'لا أصناف بعد'
tap 'إضافة سريعة بالمسح'
expect 'إضافة سريعة'
sleep 3
tap_edit
adb shell input text '6291003000017'
hide_kb
tap 'تم'
expect 'حفظ وامسح التالي'
sleep 1
adb shell input text 'Milk'
adb shell input keyevent 61
adb shell input text '25'
adb shell input keyevent 66
sleep 2
expect 'Milk'
tap 'إغلاق'
expect 'صنف'
dump; grep -q 'Milk' ui.xml && echo "OK: product listed" || { echo "::error::product not in list"; exit 1; }
adb shell input keyevent 4
sleep 2

# 5) بيع: الباركود في البحث، ثم الدفع نقدًا
tap 'بيع جديد'
expect 'السلة فارغة'
sleep 2
tap_edit
adb shell input text '6291003000017'
adb shell input keyevent 66
hide_kb
expect 'Milk'
tap 'ادفع'
expect 'المطلوب'
tap 'نقدًا'
expect 'فاتورة بيع'
expect 'A-0001'
tap 'بيع جديد'
adb shell input keyevent 4
sleep 2
tap 'الرئيسية'
expect 'مبيعات اليوم'
dump; grep -q '25.00' ui.xml && echo "OK: home shows today's sales" || { echo "::error::home sales not updated"; exit 1; }

# 6) الزبائن: زبون جديد ودين عليه
tap 'الزبائن'
expect 'لا زبائن بعد'
tap 'زبون جديد'
sleep 2
adb shell input text 'Ali'
adb shell input keyevent 66
expect 'دين جديد'
tap 'دين جديد'
sleep 2
adb shell input text '20'
adb shell input keyevent 66
sleep 2
expect 'كشف الحساب'
dump; grep -q '20.00' ui.xml && echo "OK: debt recorded" || { echo "::error::debt not shown"; exit 1; }
adb shell input keyevent 4
sleep 2
tap 'الرئيسية'
expect 'ديون الزبائن'

# 7) المخزون: الصفحة تفتح وتعرض التنبيهات (Milk بيع منه 1 بلا رصيد ← نفد)
tap 'المخزون'
expect 'التنبيهات'
expect 'اطلب من المورّد'
adb shell input keyevent 4
sleep 2

# 8) إغلاق الصندوق: بيع نقدي 25.00 ← المتوقع 25.00 ← نعدّ 25 ← مطابق
tap 'النقد في الدرج'
expect 'يجب أن يكون في الدرج الآن'
tap 'أغلق الصندوق'
sleep 2
adb shell input text '25'
adb shell input keyevent 66
expect 'الصندوق مطابق'
tap 'تم'
adb shell input keyevent 4
sleep 2

# 9) التقارير تفتح من بطاقة الرئيسية
tap 'مبيعات اليوم'
expect 'صافي المبيعات'
expect 'Excel'
adb shell input keyevent 4
sleep 2

# 10) البيانات باقية بعد إغلاق التطبيق وفتحه
adb shell am force-stop $PKG
adb shell am start -W -n $PKG/.MainActivity | tee start2.txt
echo "WARM_START_MS=$(grep -o 'TotalTime: [0-9]*' start2.txt | grep -o '[0-9]*')"
sleep 4
expect 'Shop1'
echo "smoke test passed"
