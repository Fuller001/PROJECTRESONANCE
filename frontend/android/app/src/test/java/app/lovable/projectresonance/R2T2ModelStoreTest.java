package app.lovable.projectresonance;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.io.RandomAccessFile;
import java.util.concurrent.atomic.AtomicBoolean;
import static org.junit.Assert.*;

/** Partial, truncated and cancelled files must never be accepted as installed models. */
public class R2T2ModelStoreTest {
    @Rule public TemporaryFolder files = new TemporaryFolder();

    @Test public void missingAndPartialFilesAreNotInstalled() throws Exception {
        R2T2ModelStore store = new R2T2ModelStore(files.getRoot());
        assertFalse(store.verifyInstalled(new AtomicBoolean(false)));
        assertTrue(new File(store.directory, R2T2ModelStore.DECODER + ".part").createNewFile());
        assertFalse(store.verifyInstalled(new AtomicBoolean(false)));
    }

    @Test public void wrongSizeIsRejectedEvenWithAVerificationReceipt() throws Exception {
        R2T2ModelStore store = new R2T2ModelStore(files.getRoot());
        assertTrue(store.decoder().createNewFile());
        assertTrue(new File(store.directory, R2T2ModelStore.DECODER + ".verified").createNewFile());
        assertFalse(store.verifyInstalled(new AtomicBoolean(false)));
    }

    @Test public void cancelledDownloadDoesNotStartNetworkOrInstallFiles() throws Exception {
        R2T2ModelStore store = new R2T2ModelStore(files.getRoot());
        try { store.download(new AtomicBoolean(true), (bytes, phase) -> {}); fail("Expected cancellation"); }
        catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("取消")); }
        assertFalse(store.decoder().exists());
        assertFalse(store.projector().exists());
    }

    @Test public void verificationChecksCancellationWhileHashing() throws Exception {
        R2T2ModelStore store = new R2T2ModelStore(files.getRoot());
        // A sparse file avoids allocating model-sized heap memory or writing 1 GB of test data.
        try (RandomAccessFile file = new RandomAccessFile(store.decoder(), "rw")) { file.setLength(1107404736L); }
        try { store.verifyInstalled(new AtomicBoolean(true)); fail("Expected cancellation"); }
        catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("取消")); }
        assertFalse(new File(store.directory, R2T2ModelStore.DECODER + ".verified").exists());
    }

    /** Builds the exact SHA-256 for a small bundled-copy test payload. */
    private static String sha256(byte[] data) throws Exception {
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder hex = new StringBuilder();
        for (byte value : digest) hex.append(String.format("%02x", value & 255));
        return hex.toString();
    }

    @Test public void bundledCopyInstallsOnlyVerifiedCompleteAsset() throws Exception {
        R2T2ModelStore store = new R2T2ModelStore(files.getRoot());
        byte[] payload = new byte[256 * 1024];
        for (int i = 0; i < payload.length; i++) payload[i] = (byte) (i * 31);
        File target = new File(store.directory, "asset.bin");
        java.util.List<Long> progress = new java.util.ArrayList<>();
        R2T2ModelStore.copyBundledAsset(name -> new java.io.ByteArrayInputStream(payload), "asset", target,
            payload.length, sha256(payload), new AtomicBoolean(false), (bytes, phase) -> progress.add(bytes));
        assertArrayEquals(payload, java.nio.file.Files.readAllBytes(target.toPath()));
        assertFalse(new File(store.directory, "asset.bin.bundled.part").exists());
        assertFalse(progress.isEmpty());
        assertEquals(Long.valueOf(payload.length), progress.get(progress.size() - 1));
    }

    @Test public void bundledCopyRejectsWrongHashAndLeavesNoFiles() throws Exception {
        R2T2ModelStore store = new R2T2ModelStore(files.getRoot());
        byte[] payload = new byte[4096];
        File target = new File(store.directory, "asset.bin");
        try {
            R2T2ModelStore.copyBundledAsset(name -> new java.io.ByteArrayInputStream(payload), "asset", target,
                payload.length, sha256(new byte[] {1, 2, 3}), new AtomicBoolean(false), (bytes, phase) -> {});
            fail("Expected integrity failure");
        } catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("完整性")); }
        assertFalse(target.exists());
        assertFalse(new File(store.directory, "asset.bin.bundled.part").exists());
    }

    @Test public void bundledCopyRejectsOversizedOrTruncatedAsset() throws Exception {
        R2T2ModelStore store = new R2T2ModelStore(files.getRoot());
        byte[] payload = new byte[8192];
        File target = new File(store.directory, "asset.bin");
        try {
            R2T2ModelStore.copyBundledAsset(name -> new java.io.ByteArrayInputStream(payload), "asset", target,
                payload.length - 1, sha256(payload), new AtomicBoolean(false), (bytes, phase) -> {});
            fail("Expected size failure");
        } catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("超过预期大小")); }
        assertFalse(target.exists());
        try {
            R2T2ModelStore.copyBundledAsset(name -> new java.io.ByteArrayInputStream(payload), "asset", target,
                payload.length + 1, sha256(payload), new AtomicBoolean(false), (bytes, phase) -> {});
            fail("Expected truncated asset failure");
        } catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("完整性")); }
        assertFalse(target.exists());
    }

    @Test public void bundledCopyStopsOnCancellationWithoutPromotingFile() throws Exception {
        R2T2ModelStore store = new R2T2ModelStore(files.getRoot());
        byte[] payload = new byte[64 * 1024];
        File target = new File(store.directory, "asset.bin");
        try {
            R2T2ModelStore.copyBundledAsset(name -> new java.io.ByteArrayInputStream(payload), "asset", target,
                payload.length, sha256(payload), new AtomicBoolean(true), (bytes, phase) -> {});
            fail("Expected cancellation");
        } catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("取消")); }
        assertFalse(target.exists());
    }
}
