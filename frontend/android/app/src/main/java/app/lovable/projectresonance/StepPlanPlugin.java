package app.lovable.projectresonance;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.HttpsURLConnection;

/** Keystore-backed, fixed-origin Step Plan TTS. Credentials never return to JavaScript or logs. */
@CapacitorPlugin(name = "StepPlan")
public class StepPlanPlugin extends Plugin {
    private final ExecutorService speechWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService keyWorker = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor();
    private final Object lifecycle = new Object();
    private volatile boolean foreground = true;
    private volatile boolean destroyed;
    private StepPlanKeyStore keyStore;
    private Request active;
    private int keyChanges;

    private static final class Request {
        final String id;
        volatile boolean cancelled;
        volatile boolean timedOut;
        volatile HttpsURLConnection connection;
        Request(String id) { this.id = id; }
        void cancel() {
            cancelled = true;
            HttpsURLConnection current = connection;
            if (current != null) current.disconnect();
        }
    }

    @Override
    public void load() { keyStore = new StepPlanKeyStore(getContext()); }

    /** Returns only whether the app can decrypt a saved credential. Never returns a key or key suffix. */
    @PluginMethod
    public void getStatus(PluginCall call) {
        synchronized (lifecycle) {
            if (destroyed) { call.reject("应用已关闭"); return; }
            keyWorker.execute(() -> {
                try {
                    JSObject result = new JSObject();
                    result.put("configured", keyStore.read() != null);
                    call.resolve(result);
                } catch (Exception e) { call.reject("无法读取已保存的密钥，请重新保存 API Key"); }
            });
        }
    }

    /** Saves a full user-entered key encrypted at rest; invalid values are never echoed in errors. */
    @PluginMethod
    public void saveKey(PluginCall call) {
        final String key;
        try { key = StepPlanPolicy.validateKey(call.getString("apiKey", "")); }
        catch (IllegalArgumentException e) { call.reject(e.getMessage()); return; }
        synchronized (lifecycle) {
            if (destroyed || !foreground) { call.reject("请在应用前台保存 API Key"); return; }
            cancelActive();
            keyChanges++;
            keyWorker.execute(() -> {
                boolean saved = false;
                try { keyStore.save(key); saved = true; }
                catch (Exception e) { /* Never expose storage exceptions or credential values. */ }
                finally { synchronized (lifecycle) { keyChanges--; } }
                if (saved) {
                    JSObject result = new JSObject(); result.put("configured", true); call.resolve(result);
                } else { call.reject("API Key 加密保存失败，请重试"); }
            });
        }
    }

    /** Removes the saved credential and cancels any active request. */
    @PluginMethod
    public void clearKey(PluginCall call) {
        synchronized (lifecycle) {
            if (destroyed || !foreground) { call.reject("请在应用前台移除 API Key"); return; }
            cancelActive();
            keyChanges++;
            keyWorker.execute(() -> {
                boolean removed = false;
                try { keyStore.clear(); removed = true; }
                catch (Exception e) { /* Report only a fixed safe error. */ }
                finally { synchronized (lifecycle) { keyChanges--; } }
                if (removed) {
                    JSObject result = new JSObject(); result.put("configured", false); call.resolve(result);
                } else { call.reject("API Key 移除失败，请重试"); }
            });
        }
    }

    /** Synthesizes bounded MP3 audio at the fixed Step Plan endpoint; no retries or redirects. */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        String voice = call.getString("voice", "qinqienvsheng");
        double speed = call.getDouble("speed", 1.0);
        String id = call.getString("requestId", "");
        try {
            StepPlanPolicy.validateSpeech(text, voice, speed);
            if (!id.matches("[A-Za-z0-9_-]{1,80}")) throw new IllegalArgumentException("朗读请求无效，请重试");
        } catch (IllegalArgumentException e) { call.reject(e.getMessage()); return; }
        Request request = new Request(id);
        synchronized (lifecycle) {
            if (destroyed || !foreground) { call.reject("请在应用前台朗读"); return; }
            if (keyChanges > 0) { call.reject("正在更新 API Key，请稍后再试听"); return; }
            if (active != null && !active.cancelled) { call.reject("正在生成语音，请先停止当前朗读"); return; }
            active = request;
            speechWorker.execute(() -> synthesize(call, request, text, voice, speed));
        }
    }

    private void ensureActive(Request request) throws InterruptedException {
        if (request.cancelled || request.timedOut || destroyed || !foreground) throw new InterruptedException("Cancelled");
    }

    private void synthesize(PluginCall call, Request request, String text, String voice, double speed) {
        HttpsURLConnection connection = null;
        ScheduledFuture<?> deadline = null;
        try {
            ensureActive(request);
            deadline = deadlines.schedule(() -> {
                HttpsURLConnection current;
                synchronized (lifecycle) {
                    if (active != request) return;
                    request.timedOut = true;
                    current = request.connection;
                }
                if (current != null) current.disconnect();
            }, 75, TimeUnit.SECONDS);
            final String key;
            try { key = keyStore.read(); }
            catch (Exception e) { call.reject("无法读取已保存的密钥，请重新保存 API Key"); return; }
            if (key == null) { call.reject("请先在设置中填写并保存完整的 Step Plan API Key"); return; }
            ensureActive(request);
            connection = (HttpsURLConnection) new URL(StepPlanPolicy.ENDPOINT).openConnection();
            request.connection = connection;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(60000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Authorization", "Bearer " + key);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "audio/mpeg");
            connection.setRequestProperty("Cookie", "");
            connection.setDoOutput(true);
            JSObject payload = new JSObject();
            payload.put("model", StepPlanPolicy.MODEL);
            payload.put("input", text);
            payload.put("voice", voice);
            payload.put("speed", speed);
            payload.put("volume", 1.0);
            payload.put("response_format", "mp3");
            byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(body.length);
            ensureActive(request);
            try (OutputStream stream = connection.getOutputStream()) { stream.write(body); }
            int status = connection.getResponseCode();
            ensureActive(request);
            if (status < 200 || status >= 300) { call.reject(StepPlanPolicy.httpError(status)); return; }
            String contentType = connection.getContentType();
            if (!StepPlanPolicy.isAudio(contentType)) { call.reject("Step Plan 未返回音频，请检查套餐和模型配置"); return; }
            if (connection.getContentLengthLong() > StepPlanPolicy.MAX_AUDIO_BYTES) {
                call.reject("音频文件过大，请缩短朗读文字"); return;
            }
            final byte[] bytes;
            try (InputStream stream = connection.getInputStream()) { bytes = StepPlanPolicy.readAudio(stream); }
            ensureActive(request);
            JSObject result = new JSObject();
            result.put("audioBase64", Base64.encodeToString(bytes, Base64.NO_WRAP));
            result.put("contentType", contentType);
            synchronized (lifecycle) {
                ensureActive(request);
                active = null;
                call.resolve(result);
            }
        } catch (Exception e) {
            if (request.cancelled || destroyed || !foreground) {
                call.reject("朗读已停止", "ABORTED");
            } else if (request.timedOut || e instanceof SocketTimeoutException) {
                call.reject("Step Plan 连接超时，请检查网络后重试");
            } else {
                call.reject("Step Plan 朗读失败，请检查网络或缩短文字后重试");
            }
        } finally {
            if (deadline != null) deadline.cancel(false);
            if (connection != null) connection.disconnect();
            synchronized (lifecycle) { if (active == request) active = null; }
        }
    }

    /** Cancels only the identified request so an old cancellation cannot stop a newer utterance. */
    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("requestId", "");
        synchronized (lifecycle) { if (active != null && active.id.equals(id)) active.cancel(); }
        call.resolve();
    }

    private void cancelActive() { if (active != null) active.cancel(); }

    @Override
    protected void handleOnPause() {
        synchronized (lifecycle) { foreground = false; cancelActive(); }
    }

    @Override
    protected void handleOnResume() { foreground = true; }

    @Override
    protected void handleOnDestroy() {
        synchronized (lifecycle) {
            destroyed = true; foreground = false; cancelActive();
            speechWorker.shutdownNow(); keyWorker.shutdownNow(); deadlines.shutdownNow();
        }
    }
}
