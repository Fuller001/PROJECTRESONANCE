// Shared R2T2 one-shot engine. Calls must be serialized; cancel() is thread-safe.
#pragma once
#include "llama.h"
#include "mtmd.h"
#include <atomic>
#include <memory>
#include <string>

class R2T2Engine {
public:
    // Loads both official GGUF files on CPU; throws on allocation/model errors.
    R2T2Engine(const std::string & decoder, const std::string & projector, int threads);
    // Recognizes 0.3–30 seconds of mono float32 PCM at 16 kHz; throws on cancellation/errors.
    std::string transcribe(const float * samples, size_t count);
    // Starts a new operation before checking the caller's cancellation flag.
    void prepare() noexcept;
    // Interrupts active inference without freeing an object still in use.
    void cancel() noexcept;
private:
    std::atomic<bool> cancelled_{false};
    std::unique_ptr<llama_model, decltype(&llama_model_free)> model_{nullptr, llama_model_free};
    std::unique_ptr<llama_context, decltype(&llama_free)> context_{nullptr, llama_free};
    std::unique_ptr<mtmd_context, decltype(&mtmd_free)> projector_{nullptr, mtmd_free};
    static bool abort_callback(void * data);
    static bool eval_callback(ggml_tensor * tensor, bool ask, void * data);
    void check_cancelled() const;
};
