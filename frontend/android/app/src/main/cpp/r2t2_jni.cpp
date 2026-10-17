// JNI returns UTF-8 bytes, preserving Chinese and supplementary Unicode characters.
#include "r2t2_engine.h"
#include "r2t2_backend.h"
#include <jni.h>
#include <mutex>
#include <vector>

namespace {
std::mutex engine_mutex;
std::shared_ptr<R2T2Engine> engine;

std::shared_ptr<R2T2Engine> current_engine() {
    std::lock_guard<std::mutex> lock(engine_mutex);
    return engine;
}

jbyteArray utf8_bytes(JNIEnv * env, const std::string & value) {
    auto bytes = env->NewByteArray(static_cast<jsize>(value.size()));
    if (bytes) env->SetByteArrayRegion(bytes, 0, value.size(), reinterpret_cast<const jbyte *>(value.data()));
    return bytes;
}

void reject(JNIEnv * env, const std::exception & error) {
    if (env->ExceptionCheck()) return;
    auto bytes = utf8_bytes(env, error.what());
    if (!bytes || env->ExceptionCheck()) return;
    auto charset = env->NewStringUTF("UTF-8");
    if (!charset || env->ExceptionCheck()) return;
    auto string_class = env->FindClass("java/lang/String");
    if (!string_class || env->ExceptionCheck()) return;
    auto string_ctor = env->GetMethodID(string_class, "<init>", "([BLjava/lang/String;)V");
    if (!string_ctor || env->ExceptionCheck()) return;
    auto message = env->NewObject(string_class, string_ctor, bytes, charset);
    if (!message || env->ExceptionCheck()) return;
    auto error_class = env->FindClass("java/lang/IllegalStateException");
    if (!error_class || env->ExceptionCheck()) return;
    auto error_ctor = env->GetMethodID(error_class, "<init>", "(Ljava/lang/String;)V");
    if (!error_ctor || env->ExceptionCheck()) return;
    auto exception = env->NewObject(error_class, error_ctor, message);
    if (exception) env->Throw(static_cast<jthrowable>(exception));
}
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_lovable_projectresonance_R2T2Native_configureBackend(JNIEnv * env, jclass, jstring directory, jboolean baseline) {
    try {
        std::lock_guard<std::mutex> lock(engine_mutex);
        if (engine) throw std::runtime_error("切换 CPU 后端前请释放模型");
        const char * path = env->GetStringUTFChars(directory, nullptr);
        if (!path) return nullptr;
        std::string native_directory(path);
        env->ReleaseStringUTFChars(directory, path);
        return utf8_bytes(env, configure_r2t2_backend(native_directory, baseline));
    } catch (const std::exception & e) { reject(env, e); return nullptr; }
}

extern "C" JNIEXPORT void JNICALL
Java_app_lovable_projectresonance_R2T2Native_prepare(JNIEnv *, jclass) {
    auto active = current_engine();
    if (active) active->prepare();
}
extern "C" JNIEXPORT void JNICALL
Java_app_lovable_projectresonance_R2T2Native_load(JNIEnv * env, jclass, jstring decoder, jstring projector, jint threads) {
    try {
        const char * d = env->GetStringUTFChars(decoder, nullptr);
        if (!d) return;
        std::string decoder_path(d);
        env->ReleaseStringUTFChars(decoder, d);
        const char * p = env->GetStringUTFChars(projector, nullptr);
        if (!p) return;
        std::string projector_path(p);
        env->ReleaseStringUTFChars(projector, p);
        auto loaded = std::make_shared<R2T2Engine>(decoder_path, projector_path, threads);
        std::lock_guard<std::mutex> lock(engine_mutex);
        engine = std::move(loaded);
    } catch (const std::exception & e) { reject(env, e); }
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_app_lovable_projectresonance_R2T2Native_transcribe(JNIEnv * env, jclass, jfloatArray pcm) {
    try {
        auto active = current_engine();
        if (!active) throw std::runtime_error("请先加载本地模型");
        const auto count = env->GetArrayLength(pcm);
        if (count < 4800 || count > 480000) throw std::invalid_argument("本地录音须在 0.3 到 30 秒之间");
        std::vector<float> samples(count);
        env->GetFloatArrayRegion(pcm, 0, count, samples.data());
        if (env->ExceptionCheck()) return nullptr;
        return utf8_bytes(env, active->transcribe(samples.data(), samples.size()));
    } catch (const std::exception & e) { reject(env, e); return nullptr; }
}

extern "C" JNIEXPORT void JNICALL
Java_app_lovable_projectresonance_R2T2Native_cancel(JNIEnv *, jclass) {
    // Keep cancellation inside the ownership lock so it cannot retain an engine across backend unload.
    std::lock_guard<std::mutex> lock(engine_mutex);
    if (engine) engine->cancel();
}

extern "C" JNIEXPORT void JNICALL
Java_app_lovable_projectresonance_R2T2Native_release(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lock(engine_mutex);
    engine.reset();
}
