package com.thingsbook.library;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.*;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.speech.tts.UtteranceProgressListener;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.util.*;

/** Bundled offline UI; public catalog has a separate, allowlisted HTTPS transport. */
public class MainActivity extends Activity {
  private WebView web;
  private static java.lang.ref.WeakReference<MainActivity> current=new java.lang.ref.WeakReference<>(null);
  private volatile boolean backgroundRunning,backgroundPlaying;private boolean stopped;
  public static void foregroundEnded(){MainActivity a=current.get();if(a!=null)a.runOnUiThread(()->{a.backgroundRunning=false;if(a.stopped&&!a.closing)mediaCommand("stop");});}
  public static boolean listeningPlaying(){MainActivity a=current.get();return a!=null&&a.backgroundPlaying;}
  public static void mediaCommand(String command){MainActivity a=current.get();if(a!=null)a.runOnUiThread(()->{if(!a.closing&&a.web!=null)a.web.evaluateJavascript("window.ThingsBackground && window.ThingsBackground.command("+JSONObject.quote(command)+")",null);});}

  private ZLibraryProvider provider;
  private PersonalVoices personal;private boolean personalPicker;
  private final java.util.concurrent.ExecutorService providerWorker=java.util.concurrent.Executors.newSingleThreadExecutor();
  private ValueCallback<Uri[]> picker;
  private boolean closing;
  private boolean pdfActive;
  private final String origin="https://appassets.androidplatform.net/";
  private volatile EncryptedTransfer staged;
  private final LocalFiles localFiles = new LocalFiles();
  private boolean transfer;
  private String transferName, transferMime, transferMode;
  private long transferSize;
  private static final long MAX_TRANSFER = 1024L*1024*1024;
  private TextToSpeech speech;
  private volatile boolean speechReady;
  private volatile float speechVolume=1f;
  private android.media.AudioManager audioManager;private android.media.AudioFocusRequest speechFocus;
  private final android.content.BroadcastReceiver noisy=new android.content.BroadcastReceiver(){@Override public void onReceive(android.content.Context c,Intent i){if(speech!=null)speech.stop();mediaCommand("pause");}};


  @Override public void onCreate(Bundle state) {
    super.onCreate(state);current=new java.lang.ref.WeakReference<>(this);
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE,WindowManager.LayoutParams.FLAG_SECURE);
    // Remove interrupted staging files; new transfers contain only ciphertext.
    File[] old=getCacheDir().listFiles();
    if(old!=null)for(File f:old)if(f.getName().startsWith("thingsbook-"))f.delete();
    provider=new ZLibraryProvider(this);
    web=new WebView(this);setContentView(web);
    personal=new PersonalVoices(this,(id,value,error)->runOnUiThread(()->{if(closing)return;try{if("pack-import".equals(id)){web.evaluateJavascript("window.nativePersonalPackResult && window.nativePersonalPackResult("+JSONObject.quote(error==null?"Private personal voices installed. Select one from Voice.":error)+")",null);}else{String result=new JSONObject().put(error==null?"value":"error",error==null?value:error).toString();web.evaluateJavascript("window.ThingsAndroidNeural && window.ThingsAndroidNeural.receive("+JSONObject.quote(id)+","+JSONObject.quote(result)+")",null);}}catch(Exception ignored){}}));
    web.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
    WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
    s.setMediaPlaybackRequiresUserGesture(false); // Narration continues after the original Play tap expires.
    s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    web.addJavascriptInterface(localFiles,"ThingsBookAndroid");
    web.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView w,WebResourceRequest r){return !r.getUrl().toString().startsWith(origin);}
      @Override public WebResourceResponse shouldInterceptRequest(WebView w,WebResourceRequest r){
        Uri u=r.getUrl();
        if(!"https".equals(u.getScheme())||!"appassets.androidplatform.net".equals(u.getHost()))return blocked();
        String path=u.getPath();if("/personal-audio".equals(path))return "GET".equals(r.getMethod())&&u.getQueryParameterNames().size()==1?personal.serve(u.getQueryParameter("ticket"),r.getRequestHeaders().get("Range")):blocked();if("/provider-file".equals(path))return "GET".equals(r.getMethod())&&u.getQueryParameterNames().size()==1?provider.download(u.getQueryParameter("ticket")):blocked();if("/catalog".equals(path))return "GET".equals(r.getMethod())?BookCatalog.fetch(u):blocked();if("/".equals(path))path="/index.html";
        if(path==null||path.contains("..")||path.contains("\\"))return blocked();
        if(!Arrays.asList("/index.html","/style.css","/app.js","/reader.js","/reader.css","/pdf.worker.mjs").contains(path)&&!path.startsWith("/vendor/")&&!path.startsWith("/cmaps/")&&!path.startsWith("/wasm/")&&!path.startsWith("/standard_fonts/"))return blocked();
        String mime=path.endsWith(".js")||path.endsWith(".mjs")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".wasm")?"application/wasm":path.endsWith(".html")?"text/html":"application/octet-stream";
        try{return new WebResourceResponse(mime,"UTF-8",getAssets().open("web"+path));}catch(IOException e){return blocked();}
      }
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public boolean onShowFileChooser(WebView w,ValueCallback<Uri[]> cb,FileChooserParams params){
        if(picker!=null)picker.onReceiveValue(null);picker=cb;
        try{Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);startActivityForResult(i,1);}
        catch(Exception e){picker.onReceiveValue(null);picker=null;notice("A document picker could not be opened.");}return true;
      }
      @Override public boolean onJsConfirm(WebView w,String url,String message,JsResult result){new AlertDialog.Builder(MainActivity.this).setTitle("ThingsBook").setMessage(message).setPositiveButton("Continue",(d,which)->result.confirm()).setNegativeButton("Cancel",(d,which)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;}
    });
    audioManager=(android.media.AudioManager)getSystemService(AUDIO_SERVICE);speechFocus=new android.media.AudioFocusRequest.Builder(android.media.AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_MEDIA).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build()).setWillPauseWhenDucked(true).setOnAudioFocusChangeListener(change->{if(change<0){if(speech!=null)speech.stop();mediaCommand("pause");}}).build();
    if(android.os.Build.VERSION.SDK_INT>=33)registerReceiver(noisy,new android.content.IntentFilter(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY),android.content.Context.RECEIVER_NOT_EXPORTED);else registerReceiver(noisy,new android.content.IntentFilter(android.media.AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    speech=new TextToSpeech(this,status->{speechReady=status==TextToSpeech.SUCCESS;if(speechReady){speech.setOnUtteranceProgressListener(new UtteranceProgressListener(){public void onStart(String id){}public void onRangeStart(String id,int start,int end,int frame){runOnUiThread(()->{if(!closing)web.evaluateJavascript("window.nativeSpeechBoundary && window.nativeSpeechBoundary("+JSONObject.quote(id)+","+start+")",null);});}public void onDone(String id){runOnUiThread(()->{if(!closing)web.evaluateJavascript("window.nativeSpeechEnded && window.nativeSpeechEnded("+JSONObject.quote(id)+")",null);});}public void onError(String id){runOnUiThread(()->{if(!closing)web.evaluateJavascript("window.nativeSpeechError && window.nativeSpeechError("+JSONObject.quote(id)+")",null);});}});runOnUiThread(()->web.evaluateJavascript("window.nativeSpeechReady && window.nativeSpeechReady()",null));}});
    web.loadUrl(origin);
  }
  private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
  private void notice(String text){runOnUiThread(()->{if(!closing)web.evaluateJavascript("window.nativeNotice && window.nativeNotice("+JSONObject.quote(text)+")",null);});}
  @Override public void onBackPressed(){web.evaluateJavascript("window.nativeBack && window.nativeBack()",handled->{if(!"true".equals(handled))moveTaskToBack(true);});}

  public class LocalFiles {
    @JavascriptInterface public void backgroundListening(boolean enabled,boolean reading,boolean playing){runOnUiThread(()->{backgroundPlaying=playing;if(enabled&&reading&&(playing||backgroundRunning)){try{if(!backgroundRunning&&android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},98);Intent service=new Intent(MainActivity.this,ListeningService.class);if(!backgroundRunning)startForegroundService(service);else startService(service);backgroundRunning=true;}catch(Exception e){backgroundRunning=false;stopService(new Intent(MainActivity.this,ListeningService.class));web.evaluateJavascript("window.ThingsBackground && window.ThingsBackground.disabled()",null);notice("Android did not allow background listening. Keep the app open and try again.");}}else{backgroundRunning=false;stopService(new Intent(MainActivity.this,ListeningService.class));}});}

    @JavascriptInterface public String personalStatus(){return personal.status();}
    @JavascriptInterface public void personalRequest(String id,String payload){if(id==null||!id.matches("[a-zA-Z0-9-]{1,80}")||payload==null||payload.length()>4000)return;try{personal.request(id,new JSONObject(payload));}catch(Exception ignored){}}
    @JavascriptInterface public void cancelPersonal(boolean release){personal.stop(release);}
    @JavascriptInterface public void releasePersonal(String ticket){personal.release(ticket);}
    @JavascriptInterface public void choosePersonalPack(){runOnUiThread(()->{if(personalPicker)return;personalPicker=true;personal.stop(true);try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"),4);}catch(Exception e){personalPicker=false;notice("A private voice pack picker could not open.");}});}

    @JavascriptInterface public void cancelProvider(){provider.cancel();}
    @JavascriptInterface public void providerRequest(String id,String json){
      if(id==null||!id.matches("[a-zA-Z0-9-]{1,80}")||json==null||json.length()>10000)return;
      final long dispatchEpoch=provider.generation();providerWorker.execute(()->{String answer;try{answer=new JSONObject().put("value",provider.call(new JSONObject(json),dispatchEpoch)).toString();}catch(Exception e){try{answer=new JSONObject().put("error",e instanceof IOException?e.getMessage():"Provider request could not finish.").toString();}catch(Exception ignored){answer="{}";}}final String result=answer;runOnUiThread(()->{if(!closing)web.evaluateJavascript("window.ThingsProviderBridge && window.ThingsProviderBridge.receive("+JSONObject.quote(id)+","+JSONObject.quote(result)+")",null);});});
    }

    @JavascriptInterface public String protectAccess(String secret) { return DeviceAccess.protect(secret); }
    @JavascriptInterface public String revealAccess(String wrapped) { return DeviceAccess.reveal(wrapped); }
    @JavascriptInterface public boolean acquireSpeechFocus(){return audioManager!=null&&speechFocus!=null&&audioManager.requestAudioFocus(speechFocus)==android.media.AudioManager.AUDIOFOCUS_REQUEST_GRANTED;}
    @JavascriptInterface public void setSpeechVolume(double level){if(Double.isFinite(level))speechVolume=(float)Math.max(0,Math.min(1,level));}
    @JavascriptInterface public void openSpeechSettings(){runOnUiThread(()->{try{startActivity(new Intent("com.android.settings.TTS_SETTINGS"));}catch(Exception e){startActivity(new Intent(android.provider.Settings.ACTION_SETTINGS));}});}
    @JavascriptInterface public String getSpeechVoices(){JSONArray list=new JSONArray();if(!speechReady)return list.toString();try{Set<Voice> voices=speech.getVoices();if(voices!=null)for(Voice voice:voices)if(!voice.isNetworkConnectionRequired()){JSONObject item=new JSONObject();item.put("id",voice.getName());item.put("name",voice.getLocale().getDisplayName()+" · "+voice.getName());item.put("language",voice.getLocale().toLanguageTag());list.put(item);}}catch(Exception ignored){}return list.toString();}
    @JavascriptInterface public boolean speak(String text,String voiceName,double rate,String id){if(!speechReady||text.length()>TextToSpeech.getMaxSpeechInputLength())return false;runOnUiThread(()->{boolean found=false;Set<Voice> available=speech.getVoices();if(available==null){notice("Install an offline voice in Android speech settings.");web.evaluateJavascript("window.nativeSpeechError && window.nativeSpeechError("+JSONObject.quote(id)+")",null);return;}for(Voice voice:available)if(voice.getName().equals(voiceName)&&!voice.isNetworkConnectionRequired()){found=speech.setVoice(voice)!=TextToSpeech.ERROR;break;}if(found){speech.setSpeechRate((float)Math.max(.5,Math.min(2.5,rate)));Bundle speechParams=new Bundle();speechParams.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME,speechVolume);int result=audioManager.requestAudioFocus(speechFocus)==android.media.AudioManager.AUDIOFOCUS_REQUEST_GRANTED?speech.speak(text,TextToSpeech.QUEUE_FLUSH,speechParams,id):TextToSpeech.ERROR;if(result==TextToSpeech.ERROR)web.evaluateJavascript("window.nativeSpeechError && window.nativeSpeechError("+JSONObject.quote(id)+")",null);}else{notice("This offline voice is no longer installed.");web.evaluateJavascript("window.nativeSpeechError && window.nativeSpeechError("+JSONObject.quote(id)+")",null);}});return true;}
    @JavascriptInterface public void panic(){runOnUiThread(()->{if(speech!=null)speech.stop();moveTaskToBack(true);});}
    @JavascriptInterface public void stopSpeech(){runOnUiThread(()->{if(speech!=null)speech.stop();if(audioManager!=null&&speechFocus!=null)audioManager.abandonAudioFocusRequest(speechFocus);});}
    @JavascriptInterface public synchronized boolean beginTransfer(String name,String mime,String mode){
      if(staged!=null||!"export".equals(mode))return false;
      if(!Arrays.asList("application/pdf","application/epub+zip","text/plain","application/json").contains(mime))return false;
      if("pdf".equals(mode)&&!"application/pdf".equals(mime))return false;
      try{staged=new EncryptedTransfer(getCacheDir());transfer=true;transferSize=0;transferName=name.replaceAll("[^\\p{L}\\p{N}._ -]","_");if(transferName.length()>200)transferName=transferName.substring(0,200);transferMime=mime;transferMode=mode;return true;}
      catch(Exception e){cancelTransfer();return false;}
    }
    @JavascriptInterface public synchronized boolean writeChunk(String data){
      if(!transfer||data.length()>140000)return false;
      try{byte[] bytes=Base64.decode(data,Base64.NO_WRAP);transferSize+=bytes.length;if(transferSize>MAX_TRANSFER)throw new IOException();staged.write(bytes);return true;}
      catch(Exception e){cancelTransfer();return false;}
    }
    @JavascriptInterface public synchronized boolean finishTransfer(){
      if(!transfer||staged==null)return false;
      try{staged.seal();transfer=false;}catch(IOException e){cancelTransfer();return false;}
      runOnUiThread(()->{
        try{
          Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(transferMime).putExtra(Intent.EXTRA_TITLE,transferName);startActivityForResult(i,2);
        }catch(Exception e){cancelTransfer();notice("Could not open the reader or save picker.");}
      });return true;
    }
    @JavascriptInterface public synchronized void cancelTransfer(){transfer=false;if(staged!=null)staged.close();staged=null;}
  }
  @Override protected void onActivityResult(int request,int result,Intent data){
    super.onActivityResult(request,result,data);
    if(request==1&&picker!=null){
      List<Uri> uris=new ArrayList<>();if(result==RESULT_OK&&data!=null){if(data.getClipData()!=null)for(int n=0;n<data.getClipData().getItemCount();n++)uris.add(data.getClipData().getItemAt(n).getUri());else if(data.getData()!=null)uris.add(data.getData());}
      picker.onReceiveValue(uris.isEmpty()?null:uris.toArray(new Uri[0]));picker=null;
    }
    if(request==2){
      if(result==RESULT_OK&&data!=null&&data.getData()!=null&&staged!=null){final EncryptedTransfer file=staged;final Uri destination=data.getData();new Thread(()->{try(OutputStream out=getContentResolver().openOutputStream(destination)){if(out==null)throw new IOException();file.copyTo(out);notice("File saved to your chosen location.");}catch(Exception e){notice("Could not save this file. Check free space and try again.");}finally{file.close();if(staged==file)staged=null;}}).start();}
      else{localFiles.cancelTransfer();notice("Save cancelled.");}
    }
    if(request==3)pdfActive=false;
    if(request==4){personalPicker=false;if(result==RESULT_OK&&data!=null&&data.getData()!=null){try{InputStream input=getContentResolver().openInputStream(data.getData());if(input==null)throw new IOException();notice("Installing and protecting your private voices on this device…");personal.install(input,"pack-import");}catch(Exception e){notice("The selected voice pack could not open.");}}}

  }
  @Override protected void onResume(){super.onResume();stopped=false;if(web!=null)web.evaluateJavascript("window.nativeSpeechReady && window.nativeSpeechReady()",null);}
  @Override protected void onStop(){super.onStop();stopped=true;if(!backgroundRunning&&picker==null&&!personalPicker&&staged==null&&!pdfActive&&web!=null){if(provider!=null)provider.cancel();if(personal!=null)personal.stop(true);web.evaluateJavascript("window.nativeLock && window.nativeLock()",null);}}
  @Override protected void onDestroy(){closing=true;try{unregisterReceiver(noisy);}catch(Exception ignored){}if(audioManager!=null&&speechFocus!=null)audioManager.abandonAudioFocusRequest(speechFocus);stopService(new Intent(this,ListeningService.class));if(current.get()==this)current.clear();if(personal!=null)personal.close();if(provider!=null)provider.cancel();providerWorker.shutdownNow();if(picker!=null)picker.onReceiveValue(null);localFiles.cancelTransfer();if(speech!=null){speech.stop();speech.shutdown();}if(web!=null)web.destroy();super.onDestroy();}
}
