package com.thingsbook.library;
import android.content.Context;import android.security.keystore.KeyGenParameterSpec;import android.security.keystore.KeyProperties;import android.util.AtomicFile;
import java.io.*;import java.security.KeyStore;import java.util.Arrays;import javax.crypto.*;import javax.crypto.spec.GCMParameterSpec;
/** Device-only provider credentials. Never included in library backups. */
final class ProviderSecrets{
 private final AtomicFile file;private static final String ALIAS="ThingsBook.providers.v1";
 ProviderSecrets(Context c){file=new AtomicFile(new File(c.getFilesDir(),"zlibrary-provider.session"));}
 private SecretKey key(boolean create)throws Exception{KeyStore s=KeyStore.getInstance("AndroidKeyStore");s.load(null);if(s.containsAlias(ALIAS))return(SecretKey)s.getKey(ALIAS,null);if(!create)throw new IOException();KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).setRandomizedEncryptionRequired(true).build());return g.generateKey();}
 synchronized byte[] read()throws Exception{if(!file.getBaseFile().exists())return null;if(file.getBaseFile().length()>65536)throw new IOException();byte[] packed=file.readFully();try{if(packed.length<28)throw new IOException();Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,Arrays.copyOf(packed,12)));return c.doFinal(packed,12,packed.length-12);}finally{Arrays.fill(packed,(byte)0);}}
 synchronized void write(byte[] bytes)throws Exception{if(bytes.length>32768)throw new IOException();Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key(true));byte[] enc=c.doFinal(bytes),iv=c.getIV();FileOutputStream out=null;try{out=file.startWrite();out.write(iv);out.write(enc);file.finishWrite(out);}catch(Exception e){if(out!=null)file.failWrite(out);throw e;}finally{Arrays.fill(enc,(byte)0);}}
 synchronized void delete(){file.delete();}
}
