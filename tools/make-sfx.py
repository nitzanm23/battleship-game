"""
Battleship Game: sound effects generator.

Builds every sound effect in assets/audio from noise and plain waveforms, so the game ships no
third-party samples. Run it again after changing a sound:

    python3 tools/make-sfx.py assets/audio

Needs Python 3 with NumPy, and ffmpeg on the PATH (used to encode MP3).
"""
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
OUT = sys.argv[1]
rng = np.random.default_rng(7)  # fixed seed: the same sounds on every run


def t(d):
    return np.arange(int(SR * d)) / SR


def note(n):
    return 440 * 2 ** ((n - 69) / 12)


def lowpass(x, cutoff, order=4):
    """Low-pass filter: `order` one-pole stages in a row (6 dB per octave each).
    `cutoff` may be a number or a per-sample array, for filters that sweep over time."""
    cutoff = np.broadcast_to(cutoff, x.shape)
    coeff = np.exp(-2 * np.pi * cutoff / SR)
    y = x
    for _ in range(order):
        out = np.zeros_like(y)
        p = 0.0
        for i, v in enumerate(y):
            p = (1 - coeff[i]) * v + coeff[i] * p
            out[i] = p
        y = out
    return y


def fade(x, attack=0.004, release=0.03):
    x = x.copy()
    a, r = int(SR * attack), int(SR * release)
    x[:a] *= np.linspace(0, 1, a)
    x[-r:] *= np.linspace(1, 0, r)
    return x


def tone(f, d, decay=4.0, partials=((1, 1), (2, 0.3), (3, 0.12))):
    tt = t(d)
    s = sum(a * np.sin(2 * np.pi * f * m * tt) for m, a in partials) * np.exp(-decay * tt)
    return fade(s)


def place(total, parts):
    out = np.zeros(int(SR * total))
    for start, sig in parts:
        i = int(SR * start)
        n = min(len(sig), len(out) - i)
        out[i : i + n] += sig[:n]
    return out


def saturate(x, drive=2.5):
    """Soft clipping. It adds harmonics of low rumbles, so small speakers can play them."""
    return np.tanh(drive * x / (np.max(np.abs(x)) + 1e-9))


def save(name, x, loudness=0.16):
    """Scales the loudest 300ms to the same RMS level in every effect, so a short splash and a
    long explosion sound equally loud, then soft-clips any peaks that would go past full scale."""
    win = min(len(x), int(SR * 0.3))
    rms = np.sqrt(np.convolve(x**2, np.ones(win) / win, mode="valid").max())
    x = x / (rms + 1e-9) * loudness
    x = np.tanh(x / 0.9) * 0.9
    x = fade(x, attack=0.001, release=0.02)
    path = f"/tmp/{name}.wav"
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
    target = os.path.join(OUT, f"{name}.mp3")
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", path,
         "-codec:a", "libmp3lame", "-b:a", "96k", target],
        check=True,
    )


# Miss: a splash. Bright noise that darkens as it falls back into the water, then a few drops.
d = 0.9
tt = t(d)
splash = rng.normal(0, 1, len(tt)) * np.exp(-5 * tt)
drops = place(d, [(0.28 + 0.13 * k, tone(900 + 260 * k, 0.06, 40, ((1, 1),))) for k in range(3)])
save("miss", fade(lowpass(splash, 4000 * np.exp(-3 * tt) + 300) + drops * 0.25), loudness=0.28)

# Hit: a sharp crack, then a saturated boom that small speakers can still play.
d = 0.8
tt = t(d)
crack = rng.normal(0, 1, len(tt)) * np.exp(-30 * tt)
boom = saturate(lowpass(rng.normal(0, 1, len(tt)), 500 * np.exp(-2 * tt) + 120) * np.exp(-6 * tt))
save("hit", fade(lowpass(crack, 3000) * 0.8 + boom * np.exp(-5 * tt)), loudness=0.3)


def explosion(d, cutoff, decay):
    tt = t(d)
    body = lowpass(rng.normal(0, 1, len(tt)), cutoff * np.exp(-2.5 * tt) + 150)
    return saturate(body * np.exp(-decay * tt), drive=3)


# Sunk: two explosions, the hull groaning as it goes down, and bubbles rising.
d = 2.4
tt = t(d)
groan_t = t(1.1)
groan_f = 180 * np.exp(-0.6 * groan_t) * (1 + 0.03 * np.sin(2 * np.pi * 7 * groan_t))
groan_saw = 2 * ((np.cumsum(groan_f) / SR) % 1) - 1
groan = lowpass(groan_saw, 700) * np.minimum(1, groan_t / 0.15) * np.exp(-2 * groan_t)
bubbles = [(1.35 + 0.11 * k, tone(320 + 90 * k, 0.07, 30, ((1, 1),))) for k in range(7)]
parts = [(0, explosion(1.3, 1400, 3)), (0.32, explosion(1.0, 900, 4) * 0.7), (0.55, groan * 0.45)]
sunk = place(d, parts + [(start, b * 0.3) for start, b in bubbles])
save("sunk", fade(sunk, release=0.2), loudness=0.4)

# Repeat shot: two short low beeps.
beeps = [(0, tone(note(62), 0.14, 9)), (0.17, tone(note(58), 0.17, 9))]
save("error", place(0.36, beeps), loudness=0.2)

# Victory: a rising brass-like fanfare (sawtooth through a low-pass filter).
def brass(n, d):
    tt = t(d)
    ph = note(n) * tt
    saw = 2 * (ph % 1) - 1
    env = np.minimum(1, tt / 0.04) * np.exp(-1.4 * tt)
    return fade(lowpass(saw * env, 2400))

fanfare = [(0, brass(67, 0.25)), (0.22, brass(67, 0.2)), (0.4, brass(72, 0.3)),
           (0.66, brass(76, 1.2))]
save("victory", place(1.9, fanfare), loudness=0.26)

# Defeat: a slow descending horn into a low, fading note.
horn = [(0, brass(64, 0.5)), (0.5, brass(62, 0.5)), (1.0, brass(59, 0.5)), (1.5, brass(55, 1.1))]
save("defeat", place(2.6, horn), loudness=0.26)
print("ok")
