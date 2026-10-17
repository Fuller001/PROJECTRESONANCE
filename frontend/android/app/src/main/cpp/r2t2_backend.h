// Android CPU variant selection. The caller must release all engines before changing backends.
#pragma once
#include <string>

// Loads a capability-checked CPU module from Android's trusted native directory; throws on failure.
std::string configure_r2t2_backend(const std::string & native_directory, bool baseline);
