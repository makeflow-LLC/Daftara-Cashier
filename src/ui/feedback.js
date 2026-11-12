// صوت واهتزاز لكل مسح: نغمة قصيرة عالية للنجاح، ونغمتان منخفضتان للخطأ.
// WebAudio بلا ملفات صوت (لا شيء يُضاف لحجم التطبيق).
let ctx = null;
let enabled = { sound: true, vibrate: true };

export function configureFeedback(opts) {
  enabled = { ...enabled, ...opts };
}

function tone(freq, start, dur, gain = 0.18) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return;
  ctx = ctx || new AC();
  if (ctx.state === 'suspended') ctx.resume();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function vibrate(pattern) {
  if (enabled.vibrate && navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* غير مدعوم */ }
  }
}

export const feedback = {
  ok() {
    if (enabled.sound) tone(1760, 0, 0.07);
    vibrate(35);
  },
  error() {
    if (enabled.sound) { tone(330, 0, 0.12, 0.22); tone(250, 0.15, 0.16, 0.22); }
    vibrate([60, 60, 90]);
  },
  tap() {
    vibrate(10);
  },
};
