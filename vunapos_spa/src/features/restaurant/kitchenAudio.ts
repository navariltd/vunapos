let context: AudioContext | undefined;
export async function enableKitchenAudio() {
  context ||= new AudioContext();
  await context.resume();
}
export function playKitchenTone(type: "new" | "alert") {
  if (!context || context.state !== "running") return;
  const ctx = context;
  const notes = type === "new" ? [660, 880] : [440, 440, 330];
  notes.forEach((frequency, index) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const at = ctx.currentTime + index * 0.24;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.12, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
    osc.start(at); osc.stop(at + 0.2);
  });
}
