package app.lovable.projectresonance;

/** CPU inference JNI. The plugin serializes load/transcribe/release; cancel is thread-safe. */
final class R2T2Native {
    static { System.loadLibrary("resonance-r2t2"); }
    private R2T2Native() {}
    static native byte[] configureBackend(String nativeDirectory, boolean baseline);
    static native void load(String decoder, String projector, int threads);
    static native void prepare();
    static native byte[] transcribe(float[] pcm);
    static native void cancel();
    static native void release();
}
