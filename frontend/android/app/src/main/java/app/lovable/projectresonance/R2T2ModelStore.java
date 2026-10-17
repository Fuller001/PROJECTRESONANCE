package app.lovable.projectresonance;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicBoolean;

/** App-private model files; interrupted downloads stay partial and only SHA-verified files are installed. */
final class R2T2ModelStore {
    static final String DECODER = "Confucius4-R2T2-Q4_K_M.gguf";
    static final String PROJECTOR = "mmproj-Confucius4-R2T2-Q8_0.gguf";
    static final long TOTAL_BYTES = 1107404736L + 348336544L;
    private static final String[] NAMES = {DECODER, PROJECTOR};
    private static final long[] SIZES = {1107404736L, 348336544L};
    private static final String[] HASHES = {
        "fa3cb46c8c3a66a58812b9098ba6e96a0266d4e8c9b3cf5ba34432fd2f9f6466",
        "8dc2c67e6a0484114928142d098db7ad94ae9f34c78948ef9d37a9678418cb65"
    };
    final File directory;
    private volatile HttpURLConnection activeConnection;
    interface Progress { void update(long bytes, String phase); }
    interface AssetSource { InputStream open(String name) throws IOException; }

    R2T2ModelStore(File filesDir) throws IOException {
        directory = new File(filesDir, "r2t2");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建模型目录");
    }

    File decoder() { return new File(directory, DECODER); }
    File projector() { return new File(directory, PROJECTOR); }

    /** Checks verified receipts, hashing externally imported or changed files before accepting them. */
    boolean verifyInstalled(AtomicBoolean cancelled) throws Exception {
        for (int i = 0; i < NAMES.length; i++) {
            checkCancelled(cancelled);
            File model = new File(directory, NAMES[i]);
            if (!model.isFile() || model.length() != SIZES[i]) return false;
            if (receiptMatches(model, i)) continue;
            if (!HASHES[i].equals(hash(model, cancelled))) return false;
            writeReceipt(model, i);
        }
        return true;
    }

    /** Copies only missing official APK assets; existing verified private models are reused. */
    void installBundled(AssetSource assets, AtomicBoolean cancelled, Progress progress) throws Exception {
        checkCancelled(cancelled);
        boolean[] installed = new boolean[NAMES.length];
        long required = 0;
        for (int i = 0; i < NAMES.length; i++) {
            File model = new File(directory, NAMES[i]);
            installed[i] = model.isFile() && model.length() == SIZES[i] && receiptMatches(model, i);
            if (!installed[i]) required += SIZES[i];
            File partial = new File(directory, NAMES[i] + ".bundled.part");
            if (partial.exists() && !partial.delete()) throw new IOException("无法清理内置模型临时文件");
        }
        if (required > 0 && directory.getUsableSpace() < required + 128L * 1024 * 1024) {
            throw new IOException("存储空间不足，请预留约 1.6 GB 用于准备内置模型");
        }
        long completed = 0;
        for (int i = 0; i < NAMES.length; i++) {
            checkCancelled(cancelled);
            if (!installed[i]) {
                final long previous = completed;
                copyBundledAsset(assets, NAMES[i], new File(directory, NAMES[i]), SIZES[i], HASHES[i], cancelled,
                    (bytes, phase) -> progress.update(previous + bytes, phase));
                writeReceipt(new File(directory, NAMES[i]), i);
            }
            completed += SIZES[i];
            progress.update(completed, "installing");
        }
    }

    /** Streams one asset with bounded memory; failure/cancellation never promotes a partial file. */
    static void copyBundledAsset(AssetSource assets, String name, File model, long expectedSize,
                                 String expectedHash, AtomicBoolean cancelled, Progress progress) throws Exception {
        checkCancelled(cancelled);
        File partial = new File(model.getParentFile(), model.getName() + ".bundled.part");
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long copied = 0;
            try (InputStream in = new BufferedInputStream(assets.open(name));
                 FileOutputStream out = new FileOutputStream(partial)) {
                byte[] buffer = new byte[1024 * 1024];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    checkCancelled(cancelled);
                    if (n > expectedSize - copied) throw new IOException("内置模型超过预期大小");
                    digest.update(buffer, 0, n);
                    out.write(buffer, 0, n);
                    copied += n;
                    progress.update(copied, "installing");
                }
                out.getFD().sync();
            }
            if (copied != expectedSize || !expectedHash.equals(hex(digest.digest()))) {
                throw new IOException("内置模型完整性校验失败，请重新安装完整 APK");
            }
            checkCancelled(cancelled);
            // Promote only after validation; replacement stays inside the app-private directory.
            if (model.exists() && !model.delete()) throw new IOException("无法替换旧模型");
            if (!partial.renameTo(model)) throw new IOException("无法保存内置模型");
        } finally {
            if (partial.exists() && !partial.delete()) throw new IOException("无法清理内置模型临时文件");
        }
    }

    /** Downloads/resumes both fixed official files. Throws on network, cancellation or integrity errors. */
    void download(AtomicBoolean cancelled, Progress progress) throws Exception {
        if (directory.getUsableSpace() < TOTAL_BYTES + 128L * 1024 * 1024 - storedBytes()) {
            throw new IOException("存储空间不足，请预留约 1.6 GB");
        }
        for (int i = 0; i < NAMES.length; i++) {
            checkCancelled(cancelled);
            File model = new File(directory, NAMES[i]);
            if (model.length() == SIZES[i] && HASHES[i].equals(hash(model, cancelled))) {
                writeReceipt(model, i);
                continue;
            }
            if (model.exists() && !model.delete()) throw new IOException("无法替换损坏的模型");
            File partial = new File(directory, NAMES[i] + ".part");
            if (partial.length() > SIZES[i] && !partial.delete()) throw new IOException("无法重置下载");
            long offset = partial.length();
            if (offset < SIZES[i]) {
                String address = "https://huggingface.co/netease-youdao/Confucius4-R2T2-GGUF/resolve/main/" + NAMES[i];
                HttpURLConnection connection = open(address, offset, cancelled);
                try {
                    int code = connection.getResponseCode();
                    if (code != 200 && code != 206) throw new IOException("模型下载失败（HTTP " + code + "）");
                    if (code == 206 && !String.valueOf(connection.getHeaderField("Content-Range")).startsWith("bytes " + offset + "-")) {
                        throw new IOException("模型服务器返回了错误的下载范围");
                    }
                    if (code == 200) offset = 0;
                    try (InputStream in = connection.getInputStream();
                         FileOutputStream out = new FileOutputStream(partial, offset > 0)) {
                        byte[] buffer = new byte[128 * 1024];
                        int n;
                        while ((n = in.read(buffer)) != -1) {
                            checkCancelled(cancelled);
                            if (offset + n > SIZES[i]) throw new IOException("模型文件超过预期大小");
                            out.write(buffer, 0, n);
                            offset += n;
                            progress.update(storedBytes(), "downloading");
                        }
                        out.getFD().sync();
                    }
                } finally { connection.disconnect(); activeConnection = null; }
            }
            progress.update(storedBytes(), "verifying");
            if (partial.length() != SIZES[i] || !HASHES[i].equals(hash(partial, cancelled))) {
                partial.delete();
                throw new IOException("模型完整性校验失败，请重试下载");
            }
            checkCancelled(cancelled);
            if (!partial.renameTo(model)) throw new IOException("无法保存已校验的模型");
            writeReceipt(model, i);
        }
    }

    void cancelConnection() {
        HttpURLConnection connection = activeConnection;
        if (connection != null) connection.disconnect();
    }

    private HttpURLConnection open(String address, long offset, AtomicBoolean cancelled) throws Exception {
        for (int redirects = 0; redirects < 8; redirects++) {
            checkCancelled(cancelled);
            URL url = new URL(address);
            if (!"https".equals(url.getProtocol())) throw new IOException("模型下载必须使用 HTTPS");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            activeConnection = connection;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
            int status;
            try { status = connection.getResponseCode(); }
            catch (Exception error) { connection.disconnect(); activeConnection = null; throw error; }
            if (status < 300 || status > 399) return connection;
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if (location == null) throw new IOException("模型下载地址无效");
            address = new URL(url, location).toString();
        }
        throw new IOException("模型下载重定向次数过多");
    }

    private long storedBytes() {
        long total = 0;
        for (String name : NAMES) {
            File model = new File(directory, name);
            total += model.isFile() ? model.length() : new File(directory, name + ".part").length();
        }
        return total;
    }

    private boolean receiptMatches(File model, int index) throws IOException {
        Properties receipt = new Properties();
        File stamp = new File(directory, model.getName() + ".verified");
        if (!stamp.isFile()) return false;
        try (InputStream input = new FileInputStream(stamp)) { receipt.load(input); }
        return HASHES[index].equals(receipt.getProperty("sha256"))
            && Long.toString(model.length()).equals(receipt.getProperty("size"))
            && Long.toString(model.lastModified()).equals(receipt.getProperty("mtime"));
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value & 255));
        return result.toString();
    }

    private String hash(File file, AtomicBoolean cancelled) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[1024 * 1024];
            int n;
            while ((n = in.read(buffer)) != -1) { checkCancelled(cancelled); digest.update(buffer, 0, n); }
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format("%02x", b & 255));
        return hex.toString();
    }

    private void writeReceipt(File file, int index) throws IOException {
        Properties receipt = new Properties();
        receipt.setProperty("sha256", HASHES[index]);
        receipt.setProperty("size", Long.toString(file.length()));
        receipt.setProperty("mtime", Long.toString(file.lastModified()));
        try (OutputStream out = new FileOutputStream(new File(directory, file.getName() + ".verified"))) {
            receipt.store(out, "Verified official R2T2 GGUF");
        }
    }

    private static void checkCancelled(AtomicBoolean cancelled) throws IOException {
        if (cancelled.get()) throw new IOException("操作已取消");
    }
}
