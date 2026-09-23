let ctx: AudioContext | null = null;
let listening = false;

function context() {
    if (typeof window === "undefined") {
        return null;
    }
    if (!ctx) {
        const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) {
            return null;
        }
        ctx = new Ctx();
    }
    return ctx;
}

/** Call from a click so later chimes are allowed to play. */
export function primeAudio() {
    const audio = context();
    if (!audio) {
        return;
    }
    void audio.resume();
}

export function installAudioPrime() {
    if (typeof window === "undefined" || listening) {
        return;
    }
    listening = true;
    const prime = () => {
        primeAudio();
        window.removeEventListener("pointerdown", prime, true);
    };
    window.addEventListener("pointerdown", prime, true);
}

function tone(frequency: number, start: number, duration: number, gain: number) {
    const audio = context();
    if (!audio) {
        return;
    }
    void audio.resume();
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    amp.gain.setValueAtTime(gain, audio.currentTime + start);
    amp.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + start + duration);
    osc.connect(amp);
    amp.connect(audio.destination);
    osc.start(audio.currentTime + start);
    osc.stop(audio.currentTime + start + duration);
}

export function playMarkerChime() {
    tone(523, 0, 0.12, 0.035);
    tone(784, 0.09, 0.18, 0.04);
}

export function playKnock() {
    tone(196, 0, 0.09, 0.03);
    tone(164, 0.11, 0.16, 0.025);
}
