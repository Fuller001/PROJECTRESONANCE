// Host smoke test for exactly the same inference engine used by Android JNI.
#include "r2t2_engine.h"
#include <chrono>
#include <fstream>
#include <iostream>
#include <vector>

int main(int argc, char ** argv) {
    if (argc != 4) {
        std::cerr << "Usage: resonance-r2t2-test decoder.gguf projector.gguf mono16k.f32\n";
        return 2;
    }
    try {
        std::ifstream file(argv[3], std::ios::binary | std::ios::ate);
        if (!file) throw std::runtime_error("Cannot read PCM file");
        auto size = file.tellg();
        if (size < 19200 || size > 1920000 || size % 4 != 0) throw std::runtime_error("Invalid PCM size");
        std::vector<float> samples(static_cast<size_t>(size) / sizeof(float));
        file.seekg(0);
        file.read(reinterpret_cast<char *>(samples.data()), size);
        auto start = std::chrono::steady_clock::now();
        R2T2Engine engine(argv[1], argv[2], 4);
        auto loaded = std::chrono::steady_clock::now();
        std::string text = engine.transcribe(samples.data(), samples.size());
        auto done = std::chrono::steady_clock::now();
        std::cout << "audio_seconds=" << samples.size() / 16000.0
            << " load_ms=" << std::chrono::duration_cast<std::chrono::milliseconds>(loaded-start).count()
            << " inference_ms=" << std::chrono::duration_cast<std::chrono::milliseconds>(done-loaded).count()
            << "\n" << text << "\n";
        return 0;
    } catch (const std::exception & e) { std::cerr << e.what() << "\n"; return 1; }
}
