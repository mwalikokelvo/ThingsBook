package com.thingsbook.library;

import java.io.*;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Private export staging; ephemeral RAM key, bounded authenticated records. */
final class EncryptedTransfer implements Closeable {
  private final File file;
  private final byte[] key = new byte[32];
  private final SecureRandom random = new SecureRandom();
  private DataOutputStream output;
  private boolean sealed, disposed;
  private int sequence;
  EncryptedTransfer(File directory) throws Exception {
    random.nextBytes(key);
    file = File.createTempFile("thingsbook-", ".encrypted", directory);
    try { output = new DataOutputStream(new FileOutputStream(file)); }
    catch(Exception error) { file.delete(); Arrays.fill(key,(byte)0); throw error; }
  }
  private Cipher cipher(int mode,byte[] iv,int index) throws Exception {
    Cipher value=Cipher.getInstance("AES/GCM/NoPadding");
    value.init(mode,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
    value.updateAAD(ByteBuffer.allocate(4).putInt(index).array());return value;
  }
  private void record(byte[] bytes) throws IOException {
    try {
      byte[] iv=new byte[12];random.nextBytes(iv);
      byte[] encrypted=cipher(Cipher.ENCRYPT_MODE,iv,sequence++).doFinal(bytes);
      output.writeInt(encrypted.length);output.write(iv);output.write(encrypted);
    }catch(Exception error){throw new IOException("Cannot encrypt transfer",error);}
  }
  synchronized void write(byte[] bytes) throws IOException {
    if(disposed||sealed||bytes.length==0||bytes.length>105000)throw new IOException("Invalid transfer chunk");
    record(bytes);
  }
  synchronized void seal() throws IOException {
    if(disposed||sealed)throw new IOException("Transfer closed");
    record(new byte[0]);output.close();output=null;sealed=true;
  }
  private void decrypt(OutputStream destination) throws Exception {
    try(DataInputStream input=new DataInputStream(new FileInputStream(file))) {
      int index=0;
      while(true) {
        int length=input.readInt();if(length<16||length>105016)throw new IOException("Invalid record");
        byte[] iv=new byte[12],encrypted=new byte[length];input.readFully(iv);input.readFully(encrypted);
        byte[] bytes=cipher(Cipher.DECRYPT_MODE,iv,index++).doFinal(encrypted);
        if(bytes.length==0){if(input.read()!=-1)throw new IOException("Trailing data");return;}
        try{if(destination!=null)destination.write(bytes);}finally{Arrays.fill(bytes,(byte)0);}
      }
    }
  }
  synchronized void copyTo(OutputStream destination) throws Exception {
    if(disposed||!sealed)throw new IOException("Transfer unavailable");
    // First authenticate all records and the terminal marker, then stream the export.
    // No book-sized plaintext buffer and no plaintext staging file are required.
    decrypt(null);decrypt(destination);
  }
  @Override public synchronized void close() {
    if(disposed)return;disposed=true;
    if(output!=null)try{output.close();}catch(IOException ignored){}output=null;
    Arrays.fill(key,(byte)0);file.delete();
  }
}
