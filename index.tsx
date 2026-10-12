/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { findStoreLazy } from "@webpack";
import { MediaEngineStore, useEffect, useRef, UserStore, useState, useStateFromStores } from "@webpack/common";

const SpeakingStore = findStoreLazy("SpeakingStore");

const enum Style {
    Bars = "bars",
    Line = "line",
    Waveform = "waveform",
    Spectrogram = "spectrogram"
}

const settings = definePluginSettings({
    style: {
        type: OptionType.SELECT,
        description: "Visualizer style",
        options: [
            { label: "Bars", value: Style.Bars, default: true },
            { label: "Line (oscilloscope)", value: Style.Line },
            { label: "Waveform (scrolls right to left)", value: Style.Waveform },
            { label: "Spectrogram (scrolls right to left)", value: Style.Spectrogram }
        ]
    },
    bars: {
        type: OptionType.SLIDER,
        description: "Number of bars (Bars style)",
        markers: [8, 16, 24, 32, 48],
        default: 24,
        stickToMarkers: true
    },
    scrollSpeed: {
        type: OptionType.SLIDER,
        description: "Scroll speed in pixels per frame (Waveform and Spectrogram styles)",
        markers: [0.5, 1, 2, 3, 4],
        default: 1,
        stickToMarkers: true
    },
    opacity: {
        type: OptionType.SLIDER,
        description: "Spectrum opacity",
        markers: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1],
        default: 0.4
    },
    showSelf: {
        type: OptionType.BOOLEAN,
        description: "Show a spectrum for your own microphone",
        default: true
    }
});

// Shapes of Discord's web voice engine objects (BaseWebRTCConnection and its per-user Output)
interface VoiceOutput {
    id: string;
    audioContext: AudioContext;
    streamSourceNode: MediaStreamAudioSourceNode | null;
    mute: boolean;
}

interface VoiceConnection {
    context: string;
    audioContext: AudioContext;
    outputs: Record<string, VoiceOutput>;
    input?: { audio?: { stream?: MediaStream | null; }; };
}

let outputAnalysers = new WeakMap<MediaStreamAudioSourceNode, AnalyserNode>();
let inputAnalysers = new WeakMap<MediaStream, { source: MediaStreamAudioSourceNode; analyser: AnalyserNode; }>();
const connectedNodes = new Set<{ source: AudioNode; analyser: AnalyserNode; }>();

function createAnalyser(context: AudioContext, source: AudioNode) {
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    connectedNodes.add({ source, analyser });
    return analyser;
}

function getDefaultConnection(): VoiceConnection | null {
    let found: VoiceConnection | null = null;
    MediaEngineStore.getMediaEngine().eachConnection((connection: any) => {
        found ??= connection;
    }, "default");
    return found;
}

function getAnalyser(userId: string): AnalyserNode | null {
    const connection = getDefaultConnection();
    if (!connection) return null;

    if (userId === UserStore.getCurrentUser()?.id) {
        const stream = connection.input?.audio?.stream;
        if (!stream?.getAudioTracks().length) return null;

        let entry = inputAnalysers.get(stream);
        if (!entry) {
            const source = connection.audioContext.createMediaStreamSource(stream);
            entry = { source, analyser: createAnalyser(connection.audioContext, source) };
            inputAnalysers.set(stream, entry);
        }
        return entry.analyser;
    }

    const output = connection.outputs?.[userId];
    const source = output?.streamSourceNode;
    if (!output || !source || output.mute) return null;

    let analyser = outputAnalysers.get(source);
    if (!analyser) {
        analyser = createAnalyser(output.audioContext, source);
        outputAnalysers.set(source, analyser);
    }
    return analyser;
}

interface DrawContext {
    ctx: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    analyser: AnalyserNode | null;
    width: number;
    height: number;
    dpr: number;
    color: string;
    state: DrawState;
}

interface DrawState {
    freq: Uint8Array<ArrayBuffer>;
    time: Uint8Array<ArrayBuffer>;
    history: number[];
}

function readFrequency({ analyser, state }: DrawContext) {
    if (!analyser) return null;
    if (state.freq.length !== analyser.frequencyBinCount) state.freq = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(state.freq);
    return state.freq;
}

function readTimeDomain({ analyser, state }: DrawContext) {
    if (!analyser) return null;
    if (state.time.length !== analyser.fftSize) state.time = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(state.time);
    return state.time;
}

// Voice energy sits in the lower bins, so the visualizers only use the bottom ~60% of the spectrum
const usableBins = (data: Uint8Array) => Math.floor(data.length * 0.6);

function drawBars(d: DrawContext, bars: number) {
    const { ctx, width, height, color } = d;
    ctx.clearRect(0, 0, width, height);

    const data = readFrequency(d);
    if (!data) return;

    const binsPerBar = Math.max(1, Math.floor(usableBins(data) / bars));
    const gap = 1;
    const barWidth = (width - gap * (bars - 1)) / bars;

    ctx.fillStyle = color;
    for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < binsPerBar; j++) sum += data[i * binsPerBar + j] ?? 0;
        const barHeight = Math.max(1, sum / binsPerBar / 255 * height);
        ctx.fillRect(i * (barWidth + gap), height - barHeight, barWidth, barHeight);
    }
}

function drawLine(d: DrawContext) {
    const { ctx, width, height, color } = d;
    ctx.clearRect(0, 0, width, height);

    const data = readTimeDomain(d);
    if (!data) return;

    const mid = height / 2;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
        const x = i / (data.length - 1) * width;
        // Speech rarely uses the full range, so amplify a little and clamp to the row
        const y = mid - Math.max(-1, Math.min(1, (data[i] - 128) / 128 * 2)) * mid;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

function drawWaveform(d: DrawContext, step: number) {
    const { ctx, width, height, color, state } = d;
    ctx.clearRect(0, 0, width, height);

    const data = readTimeDomain(d);
    let level = 0;
    if (data) {
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        level = Math.min(1, Math.sqrt(Math.sqrt(sum / data.length)) * 1.5);
    }

    const { history } = state;
    history.push(level);
    const maxLength = Math.ceil(width / step) + 1;
    if (history.length > maxLength) history.splice(0, history.length - maxLength);

    const mid = height / 2;
    ctx.fillStyle = color;
    for (let i = 0; i < history.length; i++) {
        const x = width - (history.length - i) * step;
        const amplitude = Math.max(0.5, history[i] * mid);
        ctx.fillRect(x, mid - amplitude, step, amplitude * 2);
    }
}

function drawSpectrogram(d: DrawContext, step: number) {
    const { ctx, canvas, width, height, dpr, color } = d;

    // Shift what is already drawn to the left, leaving an empty column on the right
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(canvas, -step * dpr, 0);
    ctx.restore();

    const data = readFrequency(d);
    if (!data) return;

    const rows = Math.min(usableBins(data), Math.max(8, Math.floor(height)));
    const binsPerRow = usableBins(data) / rows;
    const rowHeight = height / rows;

    ctx.fillStyle = color;
    for (let row = 0; row < rows; row++) {
        const value = data[Math.floor(row * binsPerRow)] / 255;
        if (value <= 0) continue;
        ctx.globalAlpha = value;
        // Low frequencies at the bottom
        ctx.fillRect(width - step, height - (row + 1) * rowHeight, step, rowHeight);
    }
    ctx.globalAlpha = 1;
}

const isScrollingStyle = (style: Style) => style === Style.Waveform || style === Style.Spectrogram;

interface SpectrumCanvasProps {
    userId: string;
    speaking: boolean;
    /** Called once a scrolling style has scrolled everything off after the user stopped speaking */
    onIdle(): void;
}

function SpectrumCanvas({ userId, speaking, onIdle }: SpectrumCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const { style, bars, scrollSpeed, opacity } = settings.use(["style", "bars", "scrollSpeed", "opacity"]);

    // Read through refs so speaking changes don't restart the animation and wipe the scrolled history
    const speakingRef = useRef(speaking);
    speakingRef.current = speaking;
    const onIdleRef = useRef(onIdle);
    onIdleRef.current = onIdle;

    useEffect(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;

        let frame = 0;
        let silentFrames = 0;
        const { color } = getComputedStyle(canvas);
        const state: DrawState = { freq: new Uint8Array(0), time: new Uint8Array(0), history: [] };

        const draw = () => {
            frame = requestAnimationFrame(draw);

            const { clientWidth: width, clientHeight: height } = canvas;
            const dpr = window.devicePixelRatio || 1;
            if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
                canvas.width = Math.round(width * dpr);
                canvas.height = Math.round(height * dpr);
            }
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            // While not speaking, draw silence so the tail scrolls out cleanly instead of showing background noise
            const analyser = speakingRef.current ? getAnalyser(userId) : null;
            if (speakingRef.current) silentFrames = 0;
            else if (isScrollingStyle(style) && ++silentFrames * scrollSpeed > width) {
                onIdleRef.current();
                return;
            }

            const d: DrawContext = { ctx, canvas, analyser, width, height, dpr, color, state };
            switch (style) {
                case Style.Line: return drawLine(d);
                case Style.Waveform: return drawWaveform(d, scrollSpeed);
                case Style.Spectrogram: return drawSpectrogram(d, scrollSpeed);
                default: return drawBars(d, bars);
            }
        };

        draw();
        return () => cancelAnimationFrame(frame);
    }, [userId, style, bars, scrollSpeed]);

    return <canvas ref={canvasRef} className="vc-voice-spectrum" style={{ opacity }} />;
}

function VoiceSpectrum({ userId }: { userId: string; }) {
    const { showSelf, style } = settings.use(["showSelf", "style"]);
    const speaking = useStateFromStores([SpeakingStore], () => SpeakingStore.isSpeaking(userId));
    const [lingering, setLingering] = useState(false);

    useEffect(() => {
        if (speaking) setLingering(true);
    }, [speaking]);

    if (!showSelf && userId === UserStore.getCurrentUser()?.id) return null;
    if (!speaking && !(lingering && isScrollingStyle(style))) return null;

    return <SpectrumCanvas userId={userId} speaking={speaking} onIdle={() => setLingering(false)} />;
}

export default definePlugin({
    name: "VoiceSpectrum",
    description: "Shows an audio spectrum behind users who are speaking in the voice channel list",
    authors: [{ name: "systemd", id: 744823748946952203n }],
    settings,

    patches: [
        {
            find: "#{intl::GUEST_NAME_SUFFIX})]",
            replacement: {
                // First child of the voice user row content, so it sits behind the avatar and name
                match: /(?<=focusProps:\{offset:\{right:4\}\},children:\(0,\i\.jsxs\)\("div",\{className:[^}]{0,40}\}\),children:\[)/,
                replace: "$self.renderSpectrum(arguments[0]?.user),"
            }
        }
    ],

    renderSpectrum(user?: { id: string; }) {
        if (!user) return null;

        return (
            <ErrorBoundary noop>
                <VoiceSpectrum userId={user.id} />
            </ErrorBoundary>
        );
    },

    stop() {
        for (const { source, analyser } of connectedNodes) {
            try {
                source.disconnect(analyser);
            } catch { }
        }
        connectedNodes.clear();
        outputAnalysers = new WeakMap();
        inputAnalysers = new WeakMap();
    }
});
