import React, { useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL, fetchFile } from "@ffmpeg/util";
import { motion } from "framer-motion";
import { Upload, Download, Settings2, Loader2 } from "lucide-react";

// Single-file React component for client-side MP4 compression using ffmpeg.wasm
// Notes:
// - Preserves MP4 container metadata with "-map_metadata 0" and movflags.
// - Browser downloads cannot preserve filesystem timestamps (Created/Modified),
//   but the app copies MP4 internal metadata (e.g., creation_time) when present and
//   saves using the same filename as the source.

export default function MP4Compressor() {
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Initializing encoder… (~20–30 MB)");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Options
  const [preset, setPreset] = useState("medium"); // ultrafast, superfast, veryfast, faster, fast, medium, slow, slower, veryslow
  const [crf, setCrf] = useState(23); // 18–28 typical
  const [resolution, setResolution] = useState("source"); // source, 1080p, 720p, 480p
  const [audioBitrate, setAudioBitrate] = useState("128k");
  const [copyMetadata, setCopyMetadata] = useState(true);

  const ffmpegRef = useRef<FFmpeg | null>(null);

  useEffect(() => {
    const load = async () => {
      if (ffmpegRef.current) return;
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on("log", ({ message }) => {
        setLogLines((prev) => {
          const next = [...prev, message];
          // crude progress estimate from pass-through log
          if (/time=\d{2}:\d{2}:\d{2}/.test(message)) {
            setProgress((p) => (p < 95 ? p + 0.5 : p));
          }
          return next.slice(-200);
        });
      });

      ffmpeg.on("progress", ({ progress }) => {
        if (!Number.isNaN(progress)) {
          setProgress(Math.min(100, Math.round(progress * 100)));
        }
      });

      try {
        // Use CDN blob URLs to load core/wasm/worker
        const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist";
        setLoadingMsg("Fetching encoder core…");
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
          workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, "text/javascript"),
        });
        setFfmpegReady(true);
        setLoadingMsg("");
      } catch (e) {
        console.error(e);
        setLoadingMsg("Failed to load encoder. Check your internet connection.");
      }
    };
    load();
  }, []);

  const onDrop = async (picked: File) => {
    setFile(picked);
    setOutputBlob(null);
    setLogLines([]);
    setProgress(0);
  };

  const start = async () => {
    if (!file || !ffmpegRef.current) return;
    setProcessing(true);
    setOutputBlob(null);
    setProgress(0);

    const ffmpeg = ffmpegRef.current;
    const inputName = "input.mp4"; // virtual FS name
    const outputName = "output.mp4";

    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const args: string[] = ["-i", inputName];

    if (copyMetadata) {
      args.push("-map_metadata", "0", "-movflags", "use_metadata_tags");
    }

    // Video settings (x264)
    args.push(
      "-c:v", "libx264",
      "-preset", preset,
      "-crf", String(crf)
    );

    // Optional scaling
    if (resolution !== "source") {
      const height = resolution === "1080p" ? 1080 : resolution === "720p" ? 720 : 480;
      // -2 keeps width divisible by 2, maintains aspect ratio
      args.push("-vf", `scale=-2:${height}`);
    }

    // Audio settings
    args.push("-c:a", "aac", "-b:a", audioBitrate);

    // Faststart for web playback
    args.push("-movflags", "+faststart");

    args.push(outputName);

    try {
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data], { type: "video/mp4" });
      setOutputBlob(blob);
      setProgress(100);
    } catch (e) {
      console.error(e);
      alert("Encoding failed. See log below for details.");
    } finally {
      setProcessing(false);
      // cleanup virtual FS
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch {}
    }
  };

  const humanSize = (bytes?: number) => {
    if (!bytes && bytes !== 0) return "";
    const thresh = 1024;
    if (Math.abs(bytes) < thresh) return bytes + " B";
    const units = ["KB", "MB", "GB", "TB"]; let u = -1; let b = bytes;
    do { b /= thresh; ++u; } while (Math.abs(b) >= thresh && u < units.length - 1);
    return b.toFixed(1) + " " + units[u];
  };

  const [origSize, setOrigSize] = useState<number | null>(null);
  const [outSize, setOutSize] = useState<number | null>(null);

  useEffect(() => {
    if (file) setOrigSize(file.size);
  }, [file]);

  useEffect(() => {
    if (outputBlob) setOutSize(outputBlob.size);
  }, [outputBlob]);

  const download = () => {
    if (!outputBlob || !file) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(outputBlob);
    // Use the same filename as the original
    a.download = file.name.endsWith(".mp4") ? file.name : `${file.name}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="max-w-4xl mx-auto px-6 pt-10 pb-6">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-3xl md:text-4xl font-semibold tracking-tight"
        >
          MP4 Size Reducer
        </motion.h1>
        <p className="mt-2 text-neutral-600">Compress MP4s in your browser with ffmpeg.wasm. Your video never leaves your device.</p>
      </header>

      <main className="max-w-4xl mx-auto px-6 pb-20">
        {/* Uploader */}
        <div className="grid gap-6">
          <div
            className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-medium mb-1">1) Select an MP4</h2>
                <p className="text-neutral-600">Drag & drop or click to choose a file.</p>
              </div>
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border bg-neutral-50 hover:bg-neutral-100 cursor-pointer">
                <Upload className="w-4 h-4" />
                <span>Pick file</span>
                <input
                  type="file"
                  accept="video/mp4"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onDrop(f);
                  }}
                />
              </label>
            </div>

            {file && (
              <div className="mt-4 grid md:grid-cols-2 gap-4">
                <div className="text-sm text-neutral-700">
                  <div className="font-medium">{file.name}</div>
                  <div className="text-neutral-500">{humanSize(file.size)}</div>
                  <div className="text-neutral-500">Type: {file.type || "video/mp4"}</div>
                </div>
                <div className="text-sm text-neutral-600">
                  <div>Metadata preservation: <span className="font-medium">{copyMetadata ? "On" : "Off"}</span></div>
                </div>
              </div>
            )}
          </div>

          {/* Options */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Settings2 className="w-4 h-4" />
              <h2 className="text-xl font-medium">2) Compression Settings</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm text-neutral-600">Quality (CRF 18–28)</label>
                <input
                  type="range"
                  min={18}
                  max={28}
                  step={1}
                  value={crf}
                  onChange={(e) => setCrf(parseInt(e.target.value))}
                />
                <div className="text-sm">CRF: <span className="font-medium">{crf}</span> (lower = better quality, larger file)</div>
              </div>

              <div className="grid gap-2">
                <label className="text-sm text-neutral-600">Preset (speed vs size)</label>
                <select
                  className="rounded-xl border px-3 py-2 bg-white"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                >
                  {["ultrafast","superfast","veryfast","faster","fast","medium","slow","slower","veryslow"].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-sm text-neutral-600">Scale (optional)</label>
                <select
                  className="rounded-xl border px-3 py-2 bg-white"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                >
                  <option value="source">Keep source</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-sm text-neutral-600">Audio bitrate</label>
                <select
                  className="rounded-xl border px-3 py-2 bg-white"
                  value={audioBitrate}
                  onChange={(e) => setAudioBitrate(e.target.value)}
                >
                  {['64k','96k','128k','160k','192k','256k'].map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={copyMetadata}
                  onChange={(e) => setCopyMetadata(e.target.checked)}
                />
                <span className="text-sm text-neutral-700">Preserve MP4 metadata (creation_time, etc.)</span>
              </label>
            </div>
          </div>

          {/* Action */}
          <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-xl font-medium mb-1">3) Compress</h2>
                {!ffmpegReady ? (
                  <p className="text-neutral-600">{loadingMsg}</p>
                ) : (
                  <p className="text-neutral-600">Ready to encode. Click start when your settings look good.</p>
                )}
              </div>
              <button
                disabled={!ffmpegReady || !file || processing}
                onClick={start}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border bg-neutral-900 text-white disabled:opacity-50"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                <span>{processing ? "Encoding…" : "Start"}</span>
              </button>
            </div>

            {/* Progress */}
            {processing || progress > 0 ? (
              <div className="mt-4">
                <div className="h-2 w-full bg-neutral-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-neutral-900"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-2 text-sm text-neutral-600">Progress: {progress}%</div>
              </div>
            ) : null}

            {/* Sizes */}
            {(origSize !== null || outSize !== null) && (
              <div className="mt-4 grid sm:grid-cols-2 gap-4 text-sm text-neutral-700">
                {origSize !== null && (
                  <div className="rounded-xl border p-3">
                    <div className="text-neutral-500">Original size</div>
                    <div className="font-medium">{humanSize(origSize)}</div>
                  </div>
                )}
                {outSize !== null && (
                  <div className="rounded-xl border p-3">
                    <div className="text-neutral-500">Compressed size</div>
                    <div className="font-medium">{humanSize(outSize)}</div>
                  </div>
                )}
              </div>
            )}

            {/* Download */}
            {outputBlob && (
              <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
                <div className="text-sm text-neutral-600">The file will download with the <span className="font-medium">same name</span> as the original.</div>
                <button
                  onClick={download}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl border bg-white hover:bg-neutral-50"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </button>
              </div>
            )}

            {/* Log */}
            {logLines.length > 0 && (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-neutral-700">Encoder log</summary>
                <pre className="mt-2 max-h-60 overflow-auto rounded-xl bg-neutral-900 text-neutral-100 p-3 text-xs whitespace-pre-wrap">{logLines.join("\n")}</pre>
              </details>
            )}

            <div className="mt-6 text-xs text-neutral-500">
              Tip: Lower CRF numbers and slower presets improve quality but increase file size and processing time.
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-4xl mx-auto px-6 pb-10 text-xs text-neutral-500">
        <p>
          Note: Web browsers cannot overwrite an existing file or set OS-level timestamps. This app preserves
          MP4 internal metadata where available and downloads using the same filename.
        </p>
      </footer>
    </div>
  );
}
