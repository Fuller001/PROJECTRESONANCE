// One-shot prompt and audio evaluation adapted from Apache-2.0 R2T2 native_ext.cpp.
#include "r2t2_engine.h"
#include "mtmd-helper.h"
#include <algorithm>
#include <cmath>
#include <mutex>
#include <stdexcept>
#include <vector>

namespace {
constexpr int context_size = 4096;
constexpr int batch_size = 512;
constexpr int max_output = 512;
}

R2T2Engine::R2T2Engine(const std::string & decoder, const std::string & projector, int threads) {
    static std::once_flag init;
    std::call_once(init, [] { llama_backend_init(); });
    auto mp = llama_model_default_params();
    mp.n_gpu_layers = 0;
    model_.reset(llama_model_load_from_file(decoder.c_str(), mp));
    if (!model_) throw std::runtime_error("无法加载识别模型，请检查文件和可用内存");
    auto cp = llama_context_default_params();
    cp.n_ctx = context_size;
    cp.n_batch = batch_size;
    cp.n_ubatch = batch_size;
    cp.n_seq_max = 1;
    cp.n_threads = cp.n_threads_batch = std::clamp(threads, 1, 4);
    cp.offload_kqv = false;
    cp.flash_attn_type = LLAMA_FLASH_ATTN_TYPE_ENABLED;
    cp.abort_callback = abort_callback;
    cp.abort_callback_data = this;
    context_.reset(llama_init_from_model(model_.get(), cp));
    if (!context_) throw std::runtime_error("无法创建识别上下文，手机内存可能不足");
    auto ap = mtmd_context_params_default();
    ap.use_gpu = false;
    ap.n_threads = cp.n_threads;
    ap.warmup = false;
    ap.cb_eval = eval_callback;
    ap.cb_eval_user_data = this;
    projector_.reset(mtmd_init_from_file(projector.c_str(), model_.get(), ap));
    if (!projector_ || !mtmd_support_audio(projector_.get())) {
        throw std::runtime_error("无法加载音频编码器，请重新校验模型");
    }
}

bool R2T2Engine::abort_callback(void * data) {
    return static_cast<R2T2Engine *>(data)->cancelled_.load();
}

bool R2T2Engine::eval_callback(ggml_tensor *, bool ask, void * data) {
    return ask || !static_cast<R2T2Engine *>(data)->cancelled_.load();
}

void R2T2Engine::prepare() noexcept { cancelled_.store(false); }
void R2T2Engine::cancel() noexcept { cancelled_.store(true); }

void R2T2Engine::check_cancelled() const {
    if (cancelled_.load()) throw std::runtime_error("识别已取消");
}

std::string R2T2Engine::transcribe(const float * samples, size_t count) {
    if (!samples || count < 4800 || count > 480000) {
        throw std::invalid_argument("本地识别支持 0.3 到 30 秒的录音");
    }
    for (size_t i = 0; i < count; ++i) {
        if (!std::isfinite(samples[i]) || std::abs(samples[i]) > 1.001f) {
            throw std::invalid_argument("录音数据无效，请重新录音");
        }
    }
    check_cancelled();
    llama_memory_clear(llama_get_memory(context_.get()), true);
    const std::string prompt = std::string("<|im_start|>system\n<|im_end|>\n<|im_start|>user\n")
        + mtmd_default_marker() + "<|im_end|>\n<|im_start|>assistant\nlanguage Chinese<asr_text>";
    std::unique_ptr<mtmd_bitmap, decltype(&mtmd_bitmap_free)> bitmap(
        mtmd_bitmap_init_from_audio(count, samples), mtmd_bitmap_free);
    std::unique_ptr<mtmd_input_chunks, decltype(&mtmd_input_chunks_free)> chunks(
        mtmd_input_chunks_init(), mtmd_input_chunks_free);
    if (!bitmap || !chunks) throw std::runtime_error("无法创建音频输入");
    mtmd_input_text input{prompt.data(), prompt.size(), true, true};
    const mtmd_bitmap * bitmaps[] = {bitmap.get()};
    if (mtmd_tokenize(projector_.get(), chunks.get(), &input, bitmaps, 1) != 0) {
        throw std::runtime_error("音频编码准备失败");
    }
    if (mtmd_helper_get_n_pos(chunks.get()) + max_output >= context_size) {
        throw std::runtime_error("录音超过本地识别容量，请缩短后重试");
    }
    check_cancelled();
    llama_pos n_past = 0;
    const int result = mtmd_helper_eval_chunks(projector_.get(), context_.get(), chunks.get(),
        0, 0, batch_size, true, &n_past);
    check_cancelled();
    if (result != 0) throw std::runtime_error("音频编码失败，错误码 " + std::to_string(result));
    std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> sampler(
        llama_sampler_init_greedy(), llama_sampler_free);
    if (!sampler) throw std::runtime_error("无法创建识别解码器");
    const auto * vocab = llama_model_get_vocab(model_.get());
    std::string text;
    for (int i = 0; i < max_output; ++i) {
        check_cancelled();
        llama_token token = llama_sampler_sample(sampler.get(), context_.get(), -1);
        if (llama_vocab_is_eog(vocab, token)) return text;
        llama_sampler_accept(sampler.get(), token);
        std::vector<char> piece(256);
        int n = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, true);
        if (n < 0) {
            piece.resize(-n);
            n = llama_token_to_piece(vocab, token, piece.data(), piece.size(), 0, true);
        }
        if (n < 0) throw std::runtime_error("识别文字解码失败");
        text.append(piece.data(), n);
        auto batch = llama_batch_get_one(&token, 1);
        if (llama_decode(context_.get(), batch) != 0) {
            check_cancelled();
            throw std::runtime_error("语音识别解码失败");
        }
        ++n_past;
    }
    throw std::runtime_error("识别输出过长，请用较短的句子重试");
}
