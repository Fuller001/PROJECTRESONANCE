package app.lovable.projectresonance;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App-private Step Plan credential encryption; the AES key never leaves Android Keystore. */
final class StepPlanKeyStore {
    private static final String ALIAS = "resonance.step_plan.api_key.v1";
    private static final String VALUE = "encrypted_api_key";
    private final SharedPreferences preferences;

    StepPlanKeyStore(Context context) {
        preferences = context.getSharedPreferences("step_plan", Context.MODE_PRIVATE);
    }

    private SecretKey encryptionKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build());
        return generator.generateKey();
    }

    /** Encrypts and commits a validated key. No plaintext fallback is permitted. */
    synchronized void save(String raw) throws Exception {
        String key = StepPlanPolicy.validateKey(raw);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, encryptionKey());
        byte[] encrypted = cipher.doFinal(key.getBytes(StandardCharsets.UTF_8));
        String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
            + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!preferences.edit().putString(VALUE, value).commit()) throw new IOException("Key save failed");
    }

    /** Decrypts only for the native HTTPS client; callers never return this value to the WebView. */
    synchronized String read() throws Exception {
        String value = preferences.getString(VALUE, null);
        if (value == null) return null;
        String[] parts = value.split(":", -1);
        if (parts.length != 2) throw new IOException("Invalid encrypted key");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, encryptionKey(),
            new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    /** Removes the saved ciphertext. The non-exportable encryption key can be reused for a new credential. */
    synchronized void clear() throws IOException {
        if (!preferences.edit().remove(VALUE).commit()) throw new IOException("Key removal failed");
    }
}
