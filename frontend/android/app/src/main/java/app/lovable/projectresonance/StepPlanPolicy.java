package app.lovable.projectresonance;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

/** Fixed Step Plan request limits and safe errors shared by the native bridge and JVM tests. */
final class StepPlanPolicy {
    static final String ENDPOINT = "https://api.stepfun.com/step_plan/v1/audio/speech";
    static final String MODEL = "stepaudio-2.5-tts";
    static final int MAX_AUDIO_BYTES = 16 * 1024 * 1024;

    private StepPlanPolicy() {}

    /** Validates a complete printable bearer credential without including its value in errors. */
    static String validateKey(String raw) {
        String key = raw == null ? "" : raw.trim();
        if (key.length() < 8 || key.length() > 512 || key.contains("...") || key.contains("*")) {
            throw new IllegalArgumentException("请输入完整 API Key，不能使用带省略号的脱敏密钥");
        }
        for (int i = 0; i < key.length(); i++) {
            if (key.charAt(i) < 33 || key.charAt(i) > 126) {
                throw new IllegalArgumentException("API Key 不能包含空格、换行或中文字符");
            }
        }
        return key;
    }

    /** Restricts text, voice and speed before any authenticated network operation. */
    static void validateSpeech(String text, String voice, double speed) {
        if (text == null || text.trim().isEmpty() || text.codePointCount(0, text.length()) > 1000) {
            throw new IllegalArgumentException("单次朗读请输入 1 到 1000 个字符");
        }
        if (voice == null || !voice.matches("[A-Za-z0-9_.:-]{1,200}")) {
            throw new IllegalArgumentException("音色 ID 无效，请重新选择音色");
        }
        if (!Double.isFinite(speed) || speed < 0.5 || speed > 2) {
            throw new IllegalArgumentException("语速应在 0.5 到 2.0 之间");
        }
    }

    /** Allows only audio media types, ignoring case and optional format parameters. */
    static boolean isAudio(String contentType) {
        return contentType != null && contentType.toLowerCase(Locale.ROOT).startsWith("audio/");
    }

    /** Returns a bounded non-empty audio buffer; never accepts an oversized response. */
    static byte[] readAudio(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            if (count > MAX_AUDIO_BYTES - output.size()) throw new IOException("音频文件过大，请缩短朗读文字");
            output.write(buffer, 0, count);
        }
        if (output.size() == 0) throw new IOException("Step Plan 未返回音频，请稍后重试");
        return output.toByteArray();
    }

    /** Maps HTTP status to useful messages without echoing arbitrary response bodies or credentials. */
    static String httpError(int status) {
        if (status == 401) return "Step Plan API Key 无效或已过期，请在设置中重新填写";
        if (status == 403) return "当前 API Key 无权使用 Step Plan 语音服务，请检查套餐和模型权限";
        if (status == 429) return "Step Plan 额度不足或请求过于频繁，请检查套餐后重试";
        if (status == 404 || status == 405) return "Step Plan 语音接口暂不可用（HTTP " + status + "），请检查套餐是否支持语音合成";
        return "Step Plan 朗读请求失败（HTTP " + status + "），请稍后重试";
    }
}
