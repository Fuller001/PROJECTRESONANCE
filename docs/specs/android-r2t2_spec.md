# Android port with Confucius4-R2T2

## Goal and existing behavior

Port the existing React/Capacitor speech communication app to an installable Android app. Replace Whisper with **on-device Confucius4-R2T2** when local mode is selected. Reuse the training, phrases, accessibility, recording, cloud voice cloning, and cloud TTS UI. The existing iOS chat engine is simulated and is outside this change.

Upstream web-app: `5c538c9`. R2T2 exposes audio-to-text, not chat or voice synthesis. Use the official Q4_K_M decoder plus Q8_0 audio projector from `netease-youdao/Confucius4-R2T2-GGUF`. Weights are not included in the APK; preserve the model license with the download instructions. Runtime source must be pinned to upstream's tested llama.cpp commit `ad6c66839af3c5646fba8c6c2e2087a1e4e38948`.

## Design and boundaries

- Android 7/API 24 or newer; local inference requires ARM64. Compile/target API 36, Java 21, Capacitor 8.
- Bundle web assets in the APK and keep a secure local origin. Route cloud API requests to an HTTPS Worker via native HTTP so existing HttpOnly/SameSite cookies work without backend CORS changes. Preserve browser behavior.
- Add a settings panel to choose cloud or local ASR, download the two exact model files, show download/error/ready states, and release loaded models. Local mode bypasses the cloud login gate so offline ASR is accessible.
- Android native plugin manages downloads into app-private storage, verifies file size and SHA-256 before promotion, and performs serial native inference off the UI thread. Interrupted downloads never count as installed. App lifecycle and plugin destruction must release model and microphone resources.
- Existing WebView MediaRecorder captures audio. Convert recordings to 16 kHz mono float32 PCM for the native ASR call. Limit local clips to 30 seconds and generation to bounded context/output sizes. Show a useful error if a clip or device is unsupported.
- Native C++ uses llama.cpp + mtmd, loads the decoder and audio encoder, evaluates the Qwen3-ASR prompt and audio, then decodes greedily. Treat the <asr_text> marker and language header as protocol metadata; only display the transcript. JNI returns UTF-8 bytes so Chinese text survives JNI encoding differences.
- Initial local version is **one-shot transcription after recording stops**. It does not claim streaming/LSP behavior or device latency. Continue cloud CosyVoice for playback and cloning; unavailable cloud service must report errors.
- Android back gesture navigates the React routes, then exits at the root. System bars/insets, audio permission denial, repeated recording and leaving the foreground must work.
- Fix upstream build defects necessary for the port: missing mobile navigation icons and non-exported ASR hook return type.

## Acceptance criteria

1. TypeScript check, frontend build and meaningful frontend tests pass.
2. Capacitor sync bundles the frontend; Gradle builds an ARM64 debug APK containing the JNI/runtime libraries.
3. Local mode can be selected without a server session. Model status distinguishes missing, downloading, installed, loading and errors. Failed/cancelled downloads do not become installed.
4. A known 16 kHz audio sample can be recognized by the pinned runtime with the chosen official GGUF files on a supported host/device, with observed results recorded. Android device performance is reported only if tested on Android.
5. PCM conversion, transcript parsing, API routing, model selection and native/cloud routing have focused regression coverage.
6. Documentation includes build commands, APK/model locations, file sizes and hashes, model license, current local vs cloud capabilities and verification limitations.

## Review decisions

Developer review: reuse the established UI and its Blob-based recording contract; isolate native inference behind one Capacitor plugin. No backend replacement is needed for local ASR.

Architecture review: GGUF alone is insufficient: audio encoder, decoder, prompt protocol and native ARM64 runtime are required. Pin all model/runtime inputs. Keep local inference opt-in until device accuracy/latency are measured.

Delivery review: do not present APK compilation or a desktop inference run as Android microphone/performance validation. Record remaining device checks and preserve reproducible setup.


## Snapdragon acceleration investigation

The user reports slow recognition and requests Snapdragon NPU acceleration. The test phone is Snapdragon 8 Gen 1 / SM8450 (Hexagon v69, Adreno 730). The pinned llama.cpp Hexagon backend builds only v73/v75/v79/v81 skeletons and clamps older devices to v73; this does not establish v69 compatibility. QNN requires separate model export, operator/shape adaptation and precision/memory validation; calibrated quantization may be considered. It is not an option that directly makes these GGUF files execute on the NPU.

A CPU follow-up benchmark may enable FP16/DOTPROD/I8MM only on the measured SM8450. Product integration must retain ARM64 baseline compatibility by selecting a backend at runtime after capability checks; do not apply a global ARMv8.6 requirement to the APK.
Manual developer/architecture review: first build an isolated Android OpenCL benchmark using the same engine, prompt, official model hashes and 6.74-second fixture. Compare CPU and actual GPU execution; record loading, encoder/prefill and decode times, transcript, driver/backend identity and failures. Allow GPU integration only after measured improvement, exact fixture transcription and lifecycle/cancellation validation. Do not relabel GPU acceleration as NPU support, silently switch models, or advertise speed from another device. Keep the installed CPU app usable while probing.

Acceptance: report the concrete v69 runtime limitation and reproducible benchmark evidence. If the GPU path cannot compile/run correctly or is slower, retain CPU and document the tested failure. Any integrated acceleration must remain selectable and expose the actual backend; CPU remains available. Review and tests remain manual because the independent review provider is unavailable.

Measured decision: all four initial OpenCL configurations returned the expected transcript, but GPU encoder/decoder/both were slower (10.04 / 10.75 / 11.89 seconds vs 9.70 seconds CPU). Three warm full-GPU runs took 12.49 / 12.27 / 12.85 seconds. CPU compiled with FP16/DOTPROD/I8MM took 4.14 / 3.54 / 3.63 seconds with the same official models and transcript. GPU remains benchmark-only.

CPU integration design (manual developer/architecture review): use the pinned upstream dynamic CPU variants and its baseline-compiled capability scoring. Package the libraries in Android's extracted native library directory. Load only CPU backends from that trusted directory; automatic selection uses runtime capability checks, and an explicit baseline mode remains available in model settings. Changing mode runs on the serialized worker, releases the model before unloading the old backend, persists the preference, and loads lazily on the next recognition. Report selected mode and actual loaded CPU variant through the bridge. Never raise the APK-wide ARM instruction requirement. No GPU or NPU backend is bundled.

CPU acceptance: verify automatic selection chooses android_armv8.6_1 on this phone; explicit baseline still recognizes the exact fixture; switching releases the old model; optimized recognition, cancellation, background release/foreground recovery and disconnected inference complete without a crash. Inspect ELF and APK alignment for every packaged library. Other ARM64 devices remain source-supported by capability selection, but physical testing is limited to this phone.

## Final validation and delivery

- Final build evidence: `android-typecheck-accel.log` (TypeScript exit 0), `android-tests-accel.log` (10 frontend suites / 73 tests), `android-web-build-accel.log` (production Vite build), `android-sync-accel.log` (Capacitor sync), and `android-gradle-final.log` (assembleDebug, lintDebug, testDebugUnitTest; 4 Java tests; `BUILD SUCCESSFUL`).
- Final debug APK: `deliverables/resonance-debug.apk`, 10,579,206 bytes, SHA-256 `0d04b8df7c6c72b8fead6ed28cdce2d20ede96a425853c8317c0e0bb3aadf87f`. `deliverables/resonance-debug.apk.sha256` is the checksum file. It contains 13 `arm64-v8a` native libraries, including seven runtime-selected CPU variants, and no `.gguf` weights. `apksigner verify` passed with the Android debug signer; `zipalign -c -P 16 -v 4` passed. ELF evidence for every packaged library is in `deliverables/evidence/apk-native-elf-final.txt`; displayed `LOAD` alignment is `0x4000`.
- Official models remain outside the APK in app-private storage. Decoder: 1,107,404,736 bytes, SHA-256 `fa3cb46c8c3a66a58812b9098ba6e96a0266d4e8c9b3cf5ba34432fd2f9f6466`; projector: 348,336,544 bytes, SHA-256 `8dc2c67e6a0484114928142d098db7ad94ae9f34c78948ef9d37a9678418cb65`; combined 1,455,741,280 bytes. The APK download/install itself does not install weights; use the in-app model download or the documented verified import path.
- Installed app validation on Samsung SM-S908U / Snapdragon 8 Gen 1 / Android 15: automatic mode selected `CPU android_armv8.6_1`; three warm fixture runs took 3,264 / 3,658 / 3,789 ms native inference and all returned `之前有顾客自己带酒水，也没加收钱或者不让喝。`. Baseline mode selected `CPU android_armv8.0_1`; three runs took 8,662 / 9,502 / 9,738 ms and returned the same text. The mode switch released the loaded model before lazy reload, and the preference survived app restart; the earlier CPU handoff state was automatic, loaded, ready, and idle. NPU cleanup reloaded the optimized CPU successfully; a later sleep/resume observation was automatic, installed, unloaded and idle. These separate observations are recorded in deliverables/evidence/npu-v69/phone-cleanup.json.
- Lifecycle/offline evidence: optimized cancellation returned in 3.4 ms and settled with `操作已取消`; the backgrounded 26.96-second controlled task settled cancelled with `busy: false`, `loaded: false`, and no crash. With Wi-Fi and mobile data disabled and no active default network, the app still loaded the private fixture and recognized it correctly in 4,042 ms native inference. The real microphone button was started/stopped through the WebView, the track ended, and silent input correctly reported no speech. A second attempt played the verified WAV through the WebView speaker path while recording; the complete microphone-to-WebM-to-PCM-to-local-ASR path settled with the same no-speech result. This was speaker playback captured by the microphone, not natural-speech or speech-disorder accuracy; positive microphone accuracy remains unverified.
- Cloud limitation: native probes of the configured public origin returned frontend HTML for API paths, while the discovered Worker origin timed out from the phone. Cloud session, TTS, voice cloning, and authenticated end-to-end behavior therefore remain unverified on this network. Local R2T2 recognition is the verified disconnected path.
- Review provenance: code/security review was manual. The independent review provider was unavailable and the referenced workflow/quality-gate files were absent, so no independent gate approval is claimed. The latest dependency assessment retains 18 audit findings overall (10 moderate, 6 high, 2 critical; 12 production-classified) and is documented separately.


## Hexagon v69 execution follow-up

The user explicitly requested an actual NPU attempt. Use an isolated host workspace and a unique `/data/local/tmp/resonance-npu/` device directory. Preserve the installed APK, official private model files, CPU preferences, and the active scrcpy session. Do not force v73 binaries onto v69. Record current device settings rather than overwriting user changes made since delivery.

Manual feasibility design: use the official Maven QNN runtime with its v69 stub/skeleton and matching ONNX Runtime QNN package. First execute a deterministic quantized graph with `session.disable_cpu_ep_fallback=1`, QNN HTP selected explicitly, output correctness checks, logs, and stage timings. If that succeeds, test a computation extracted from the exact official R2T2 model and assess the full encoder/decoder conversion boundary. A capability query, successful library load, or small graph alone is not successful R2T2 transcription and must never be reported as R2T2 latency. Only a full fixture transcript supports an end-to-end latency comparison. If execution or conversion is blocked, retain the concrete error and evidence, document the limit, and remove task-owned device test files.

Observed execution: ORT QNN 1.20.0 is paired with its declared QNN runtime 2.27.0 (backend build `v2.27.0.240926142112_100894`). The initial linker failure was resolved by declaring the public vendor library `libcdsprpc.so` in the probe manifest and setting `ADSP_LIBRARY_PATH` to the app's native library directory and vendor DSP directories. Basic profiling also requires a per-case `profiling_file_path`; `offload_graph_io_quantization=0` keeps graph I/O quantization with QNN. All tests retain `htp_arch=69` and `session.disable_cpu_ep_fallback=1`.

The QDQ MatMul and FLOAT Add graphs execute on HTP and return correct outputs in all three runs. `QLinearMatMul` remains a negative control: current QNN EP rejects that representation at session creation because CPU fallback is disabled. It does not establish a general MatMul or HTP v69 limitation.

The official projector's `a.blk.0.attn_q.weight` (Q8_0, 1024 × 1024) and original F32 bias were extracted only after verifying projector SHA-256 `8dc2c67e6a0484114928142d098db7ad94ae9f34c78948ef9d37a9678418cb65`. The pinned GGUF implementation dequantizes the exact source weight; it is not replaced or requantized. A synthetic `[13,1024]` input tests MatMul + bias. ONNX checker, ReferenceEvaluator and NumPy agree on the host. On device, ORT fuses MatMul + Add into Gemm, lowered to QNN FullyConnected; native validation explicitly reports FP16. All optimized nodes are assigned to QNN.

| Case | Session creation (ms) | First session.run (us) | Repeats (us) | Result |
|---|---:|---:|---:|---|
| QDQ MatMul | 645 | 5,522 | 1,775 / 1,398 | Correct `[2,4,6,8]` in all 3 runs |
| FLOAT Add | 465 | 4,298 | 1,704 / 1,680 | Correct within 0.0001 in all 3 runs |
| Official query projection | 808 | 5,976 | 2,409 / 3,039 | All 13,312 values pass in all 3 runs |
| QLinearMatMul | Rejected | — | — | Unsupported representation; no CPU fallback |

Core QNN library loading took 2 ms in this run. `session.run` excludes input preparation, output extraction and correctness checks. Projection max absolute error is `0.0018372535705566406`, RMSE `0.00024686445390784985`, all finite; predeclared per-value tolerance is `0.01 + 0.005 * abs(expected)` and maximum RMSE is `0.003`. All three output SHA-256 values are `7db568c634ac6b68632fd6766689a82523e4439cc65a0fcaf0e672e499839eed`, confirmed by a separate host-side comparison of exported raw floats. QNN profile records accelerator execute `284 / 86 / 86 us`; these internal measurements are distinct from Java session.run and full ASR latency.

Conversion assessment: the projector contains 24 audio blocks (embedding 1024, feed-forward 4096, 16 attention heads), while the Q4_K_M decoder has 28 blocks, embedding 2048, 16 query / 8 KV heads and 1,720,574,976 tensor elements. Expanding decoder tensors alone to FP32 would need 6,882,299,904 bytes before runtime, activations or cache. This is a size assessment, not a measured memory failure. Full conversion still needs faithful audio preprocessing/position encoding, encoder shapes and attention, decoder prefill and autoregressive KV caching, bounded graph partitions, and precision/memory validation. Calibrated QDQ conversion may be evaluated if needed, with the official source model kept fixed. Only an exact official fixture transcript on the full HTP path can establish correctness and support end-to-end NPU/CPU comparisons. Those full-model checks are not complete.

Reproducible evidence is under `deliverables/evidence/npu-v69/`: run-specific process logs, original and cumulative CSV profiles, raw inputs/reference/device outputs, source snapshots, graph/APK/runtime hashes, projection manifest and structured `results.json`. The independent review provider and workflow rule files remain unavailable; review is manual. The delivered CPU APK and its model files were preserved; this isolated probe establishes a real-weight layer's execution, not an integrated R2T2 NPU backend.

Final cleanup is recorded in `deliverables/evidence/npu-v69/phone-cleanup.json`: isolated package uninstalled; task device directory, controlled WAV/UI files and tcp:9222 forwarding absent; formal package, model sizes/receipts, auto preference and responsive scrcpy preserved. Device settings remain stay-awake 0 / Wi-Fi 1 / mobile data 1. The archive's 38 files pass `SHA256SUMS`; all 39,936 exported projection values were rechecked successfully. This documentation/evidence follow-up does not change the formal APK or require rebuilding it.


## CPU-only single-APK delivery (supersedes thin-APK model setup)

The user ended NPU work and requested one install-ready APK. Bundle the exact two official GGUF files under APK assets/r2t2 with ZIP STORED/noCompress; no NPU/QNN libraries or graphs enter the formal package. Gradle must fail when a model is missing, wrong-sized or SHA-mismatched, and must not copy unrelated files from the host models directory. Version code advances for replacement installation; retain the package ID and debug signing identity.

On first launch the serial model worker verifies existing private models. Valid files/receipts are reused. Missing models are copied from APK assets to a separate temporary file, with bounded buffers, cancellation checks, progress, size/SHA validation and fsync before promotion; only then write the receipt. Background/destroy cancels copying; a foreground resume or explicit retry restarts preparation without network. Never accept partial, truncated, oversized, hash-mismatched or cancelled assets. Preserve existing app preferences, Step Plan Keystore data and CPU runtime selection. Keep UI labels clear about preparing built-in models instead of downloading.

Acceptance: focused Java copier/store tests and frontend model-status tests; existing frontend tests/typecheck/build and Android tests/lint/assemble; verify both embedded model hashes, STORED entries, signature and ZIP/native ELF alignment. Install the single APK on the test phone and verify a no-model first launch prepares both files without network and recognizes the exact official fixture with a CPU backend. Preserve/restore pre-existing private model files during this test. Record APK size/hash and free-storage requirements (APK plus approximately 1.46 GB private models; reserve at least 5 GB for installer staging). Screen remains awake throughout device validation. Do not claim offline Step Plan TTS: it still needs a valid Key entered in the app and an Internet connection. No model training/requantization, NPU integration, commit or publication.

Review is manual if the independent provider remains unavailable. The spec/quality-gate rule files referenced by the repository remain missing; do not invent approval.
