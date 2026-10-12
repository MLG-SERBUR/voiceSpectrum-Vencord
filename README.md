# voiceSpectrum-Vencord

A Vencord plugin that draws an audio visualizer behind users who are speaking in the voice channel list.

## Styles

- **Bars**: frequency spectrum bars
- **Line**: live waveform line (oscilloscope)
- **Waveform**: volume waveform scrolling from right to left
- **Spectrogram**: frequency spectrum scrolling from right to left

The scrolling styles keep scrolling after the user stops speaking until the history has moved off the row.

## Settings

- Visualizer style
- Number of bars (Bars style)
- Scroll speed (Waveform and Spectrogram styles)
- Opacity
- Whether to show your own microphone

## How it works

The plugin attaches an `AnalyserNode` to the per-user audio outputs of Discord's web voice engine, so it only reads audio and does not change playback. It works on Discord web and Vesktop; it does not work on the official desktop client, which uses a native voice engine.

## Installation

Requires a [Vencord dev install](https://docs.vencord.dev/installing/). From the root of the Vencord checkout:

```bash
git clone https://git.c30.life/ced/voiceSpectrum-Vencord src/userplugins/voiceSpectrum
pnpm build
```

Then restart Discord (or Vesktop) and enable **VoiceSpectrum** in Vencord settings → Plugins.
