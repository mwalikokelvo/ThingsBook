package com.thingsbook.library;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** A non-exportable, app-scoped Keystore key protects device access only.
 * Portable backups never contain this key or a device access record. */
final class DeviceAccess {
  private static final String ALIAS = "ThingsBook.device-access.v1";
  private static SecretKey key(boolean create) throws Exception {
    KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
    if (store.containsAlias(ALIAS)) return (SecretKey)store.getKey(ALIAS, null);
    if (!create) throw new IllegalStateException("Device key unavailable");
    KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
    generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setKeySize(256).setRandomizedEncryptionRequired(true).build());
    return generator.generateKey();
  }
  static synchronized String protect(String secret) {
    if (secret == null || secret.isEmpty() || secret.length() > 4096) return "";
    byte[] plain = secret.getBytes(StandardCharsets.UTF_8);
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key(true));
      byte[] iv = cipher.getIV(), encrypted = cipher.doFinal(plain), packed = new byte[iv.length+encrypted.length];
      System.arraycopy(iv,0,packed,0,iv.length); System.arraycopy(encrypted,0,packed,iv.length,encrypted.length);
      return Base64.encodeToString(packed,Base64.NO_WRAP);
    } catch(Exception ignored) { return ""; } finally { Arrays.fill(plain,(byte)0); }
  }
  static synchronized String reveal(String wrapped) {
    if (wrapped == null || wrapped.length() < 40 || wrapped.length() > 32768) return "";
    byte[] plain = null;
    try {
      byte[] packed = Base64.decode(wrapped,Base64.NO_WRAP);
      if (packed.length < 28) return "";
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,Arrays.copyOf(packed,12)));
      plain = cipher.doFinal(packed,12,packed.length-12);
      return new String(plain,StandardCharsets.UTF_8);
    } catch(Exception ignored) { return ""; } finally { if(plain!=null)Arrays.fill(plain,(byte)0); }
  }
}
