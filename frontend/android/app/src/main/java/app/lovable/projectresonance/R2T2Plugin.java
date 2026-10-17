package app.lovable.projectresonance;

import android.Manifest;
import android.content.res.AssetManager;
import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Serial local ASR/model management. Audio and transcripts never leave this plugin. */
@CapacitorPlugin(name = "R2T2", permissions = {
    @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO})
})
public class R2T2Plugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Object lifecycleLock = new Object();
    private volatile boolean destroyed;
    private final AtomicBoolean busy = new AtomicBoolean(true);
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private volatile boolean foreground = true;
    private volatile boolean installed;
    private volatile boolean loaded;
    private volatile String phase = "verifying";
    private volatile String error;
    private volatile long downloadedBytes;
    private volatile long lastProgress;
    private R2T2ModelStore store;
    private volatile String backendMode = "auto";
    private volatile String activeBackend;
    private interface Work { JSObject run() throws Exception; }

    @Override
    public void load() {
        backendMode = getContext().getSharedPreferences("r2t2", Context.MODE_PRIVATE)
            .getString("backendMode", "auto");
        if (!"baseline".equals(backendMode)) backendMode = "auto";
        worker.execute(() -> {
            try {
                prepareBundledModels();
                phase = "installed";
            } catch (Exception e) { phase = "error"; error = e.getMessage(); }
            finally { busy.set(false); publish(); }
        });
    }
    private void prepareBundledModels() throws Exception {
        if (store == null) store = new R2T2ModelStore(getContext().getFilesDir());
        phase = "verifying";
        publish();
        installed = store.verifyInstalled(cancelled);
        if (installed) return;
        phase = "installing";
        downloadedBytes = 0;
        publish();
        AssetManager assets = getContext().getAssets();
        store.installBundled(name -> assets.open("r2t2/" + name, AssetManager.ACCESS_STREAMING), cancelled,
            (bytes, state) -> {
                downloadedBytes = bytes;
                phase = state;
                long now = System.currentTimeMillis();
                if (now - lastProgress > 300 || bytes == R2T2ModelStore.TOTAL_BYTES) {
                    lastProgress = now;
                    publish();
                }
            });
        installed = store.verifyInstalled(cancelled);
        if (!installed) throw new IllegalStateException("内置模型校验失败");
    }


    private boolean supported() {
        return Arrays.asList(Build.SUPPORTED_ABIS).contains("arm64-v8a");
    }

    private JSObject status() {
        JSObject result = new JSObject();
        result.put("supported", supported());
        result.put("installed", installed);
        result.put("loaded", loaded);
        result.put("backendMode", backendMode);
        result.put("activeBackend", loaded ? activeBackend : null);
        result.put("phase", phase);
        result.put("busy", busy.get());
        result.put("error", error);
        result.put("downloadedBytes", installed ? R2T2ModelStore.TOTAL_BYTES : downloadedBytes);
        result.put("totalBytes", R2T2ModelStore.TOTAL_BYTES);
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory);
        result.put("totalMemoryBytes", memory.totalMem);
        result.put("availableMemoryBytes", memory.availMem);
        return result;
    }

    private void publish() { if (!destroyed) notifyListeners("statusChanged", status()); }

    private void perform(PluginCall call, String nextPhase, Work work) {
        if (!supported()) { call.reject("本地识别需要 ARM64 手机"); return; }
        synchronized (lifecycleLock) {
            if (destroyed || !foreground) { call.reject("请在应用前台执行此操作"); return; }
            if (!busy.compareAndSet(false, true)) { call.reject("本地引擎正在处理，请稍候"); return; }
            cancelled.set(false);
            error = null;
            phase = nextPhase;
            publish();
            worker.execute(() -> {
                try {
                    if (cancelled.get() || !foreground) throw new IllegalStateException("操作已取消");
                    JSObject result = work.run();
                    if (cancelled.get() || !foreground) throw new IllegalStateException("操作已取消");
                    phase = loaded ? "ready" : installed ? "installed" : "missing";
                    call.resolve(result);
                } catch (Exception | LinkageError | OutOfMemoryError e) {
                    error = cancelled.get() ? "操作已取消" : e instanceof OutOfMemoryError ? "可用内存不足，请关闭其他应用后重试" : e.getMessage();
                    phase = "error";
                    call.reject(error == null ? "本地引擎操作失败" : error);
                    Log.w("R2T2", "Operation failed: " + nextPhase + ": " + error);
                } finally { busy.set(false); publish(); }
            });
        }
    }

    /** Returns bounded model/device status; no model paths or audio are exposed. */
    @PluginMethod
    public void getStatus(PluginCall call) { call.resolve(status()); }

    /** Prepares and SHA-verifies bundled assets offline; retained bridge name supports existing clients. */
    @PluginMethod
    public void downloadModels(PluginCall call) {
        perform(call, "installing", () -> { prepareBundledModels(); return new JSObject(); });
    }

    private void ensureLoaded() throws Exception {
        if (loaded) return;
        if (store == null || !store.verifyInstalled(cancelled)) {
            installed = false;
            throw new IllegalStateException("请在设置中下载并校验本地模型");
        }
        installed = true;
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory);
        if (memory.lowMemory) {
            throw new IllegalStateException("系统可用内存不足，请关闭其他应用后重试或切换云端识别");
        }
        phase = "loading";
        publish();
        activeBackend = new String(R2T2Native.configureBackend(
            getContext().getApplicationInfo().nativeLibraryDir, "baseline".equals(backendMode)), StandardCharsets.UTF_8);
        R2T2Native.load(store.decoder().getAbsolutePath(), store.projector().getAbsolutePath(),
            Math.min(4, Runtime.getRuntime().availableProcessors()));
        if (cancelled.get() || !foreground) {
            R2T2Native.release();
            throw new IllegalStateException("模型加载已取消");
        }
        loaded = true;
    }

    /** Switches CPU selection on the serialized worker; the next recognition reloads the model lazily. */
    @PluginMethod
    public void setBackendMode(PluginCall call) {
        String mode = call.getString("mode", "");
        if (!"auto".equals(mode) && !"baseline".equals(mode)) { call.reject("无效的 CPU 模式"); return; }
        perform(call, "loading", () -> {
            release();
            backendMode = mode;
            activeBackend = null;
            getContext().getSharedPreferences("r2t2", Context.MODE_PRIVATE).edit()
                .putString("backendMode", mode).apply();
            return status();
        });
    }

    /** Loads the verified decoder/audio projector on the worker, reporting allocation failures. */
    @PluginMethod
    public void loadModel(PluginCall call) {
        perform(call, "loading", () -> { ensureLoaded(); return new JSObject(); });
    }

    /** Accepts only bounded little-endian float32, 16 kHz mono PCM; returns UTF-8 transcript and timing. */
    @PluginMethod
    public void transcribe(PluginCall call) {
        String base64 = call.getString("pcmBase64", "");
        if (call.getInt("sampleRate", 0) != 16000 || base64.length() > 2560000 || base64.isEmpty()) {
            call.reject("本地录音格式无效或超过 30 秒"); return;
        }
        perform(call, "processing", () -> {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            if (bytes.length < 19200 || bytes.length > 1920000 || bytes.length % 4 != 0) {
                throw new IllegalArgumentException("本地录音须在 0.3 到 30 秒之间");
            }
            float[] pcm = new float[bytes.length / 4];
            ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(pcm);
            ensureLoaded();
            R2T2Native.prepare();
            if (cancelled.get() || !foreground) { R2T2Native.cancel(); throw new IllegalStateException("识别已取消"); }
            phase = "processing";
            publish();
            long start = System.nanoTime();
            byte[] output = R2T2Native.transcribe(pcm);
            if (cancelled.get()) throw new IllegalStateException("识别已取消");
            JSObject result = new JSObject();
            result.put("text", new String(output, StandardCharsets.UTF_8));
            result.put("elapsedMs", (System.nanoTime() - start) / 1000000);
            result.put("backend", activeBackend);
            result.put("audioDurationMs", pcm.length * 1000L / 16000);
            Log.i("R2T2", "Recognized " + pcm.length + " samples in " + result.getLong("elapsedMs") + " ms");
            return result;
        });
    }

    /** Cancels network/inference without freeing resources still in use by a worker. */
    @PluginMethod
    public void cancel(PluginCall call) { cancelWork(); call.resolve(); }

    private void cancelWork() {
        cancelled.set(true);
        if (store != null) store.cancelConnection();
        if (loaded) R2T2Native.cancel();
    }

    /** Releases model memory after the current operation settles. */
    @PluginMethod
    public void releaseModel(PluginCall call) {
        cancelWork();
        synchronized (lifecycleLock) {
            if (destroyed) { call.reject("应用已关闭"); return; }
            worker.execute(() -> { release(); call.resolve(status()); });
        }
    }

    private void release() {
        if (loaded) R2T2Native.release();
        loaded = false;
        phase = installed ? "installed" : "missing";
        publish();
    }

    /** Requests Android microphone permission before the WebView starts recording. */
    @PluginMethod
    public void requestMicrophone(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) microphoneResult(call);
        else requestPermissionForAlias("microphone", call, "microphoneResult");
    }

    @PermissionCallback
    private void microphoneResult(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("麦克风权限被拒绝，请在系统设置 → 应用 → 知音 → 权限中允许麦克风");
        } else call.resolve();
    }

    @Override
    protected void handleOnResume() { synchronized (lifecycleLock) { foreground = true; } }

    @Override
    protected void handleOnPause() {
        synchronized (lifecycleLock) {
            foreground = false;
            cancelWork();
            if (!destroyed) worker.execute(this::release);
        }
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (lifecycleLock) {
            if (destroyed) return;
            foreground = false;
            destroyed = true;
            cancelWork();
            worker.execute(this::release);
            worker.shutdown();
        }
    }
}
