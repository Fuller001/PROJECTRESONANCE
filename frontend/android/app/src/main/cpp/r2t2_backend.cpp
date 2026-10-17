// Select only packaged CPU modules; upstream score functions are compiled without ARM extension flags.
#include "r2t2_backend.h"
#include "ggml-backend.h"
#include <dlfcn.h>
#include <stdexcept>

namespace {
ggml_backend_reg_t active_backend = nullptr;
std::string active_variant;
constexpr const char * variants[] = {
    "android_armv8.0_1", "android_armv8.2_1", "android_armv8.2_2",
    "android_armv8.6_1", "android_armv9.0_1", "android_armv9.2_1", "android_armv9.2_2"
};
}

std::string configure_r2t2_backend(const std::string & native_directory, bool baseline) {
    std::string selected;
    int best_score = 0;
    for (const char * variant : variants) {
        if (baseline && std::string(variant) != variants[0]) continue;
        const std::string path = native_directory + "/libggml-cpu-" + variant + ".so";
        void * handle = dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL);
        if (!handle) continue;
        auto score = reinterpret_cast<int (*)()>(dlsym(handle, "ggml_backend_score"));
        const int value = score ? score() : 0;
        dlclose(handle);
        if (value > best_score) { best_score = value; selected = variant; }
    }
    if (selected.empty()) throw std::runtime_error("没有兼容的 CPU 后端，请重新安装应用");
    if (active_backend && selected == active_variant) return "CPU " + active_variant;
    if (active_backend) {
        ggml_backend_unload(active_backend);
        active_backend = nullptr;
        active_variant.clear();
    }
    const std::string path = native_directory + "/libggml-cpu-" + selected + ".so";
    active_backend = ggml_backend_load(path.c_str());
    if (!active_backend && !baseline) {
        selected = variants[0];
        const std::string fallback = native_directory + "/libggml-cpu-" + selected + ".so";
        active_backend = ggml_backend_load(fallback.c_str());
    }
    if (!active_backend) throw std::runtime_error("无法加载 CPU 后端，请重新安装应用");
    active_variant = selected;
    return "CPU " + active_variant;
}
