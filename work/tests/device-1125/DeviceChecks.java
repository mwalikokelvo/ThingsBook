package com.thingsbook.devicechecks;

import android.app.Instrumentation;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebResourceResponse;
import org.json.*;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;

/** Signed, removable test harness. Never exports books, voice states or audio. */
public final class DeviceChecks extends Instrumentation {
 private Bundle args;
 @Override public void onCreate(Bundle b){super.onCreate(b);args=b;start();}
 private static Method method(Class<?> c,String name,Class<?>... types)throws Exception{Method m=c.getDeclaredMethod(name,types);m.setAccessible(true);return m;}
 private static Object construct(Class<?> c,Class<?>[] types,Object... values)throws Exception{Constructor<?> x=c.getDeclaredConstructor(types);x.setAccessible(true);return x.newInstance(values);}
 @Override public void onStart(){
  JSONObject report=new JSONObject();Object engine=null;Class<?> cls=null;
  try{
   report.put("scope","Real Android production JNI, Keystore and pack; numerical audio only, not human listening or UI acceptance");
   report.put("android",android.os.Build.VERSION.RELEASE).put("model",android.os.Build.MODEL).put("process64",android.os.Process.is64Bit());
   ClassLoader loader=getTargetContext().getClassLoader();
   cls=loader.loadClass("com.thingsbook.library.PersonalVoices");Class<?> reply=loader.loadClass("com.thingsbook.library.PersonalVoices$Reply");
   BlockingQueue<Object[]> responses=new LinkedBlockingQueue<>();
   Object callback=Proxy.newProxyInstance(loader,new Class[]{reply},(proxy,m,a)->{if(m.getName().equals("done"))responses.offer(a);return null;});
   engine=construct(cls,new Class[]{android.content.Context.class,reply},getTargetContext(),callback);
   JSONObject initial=new JSONObject((String)method(cls,"status").invoke(engine));
   report.put("native_supported",initial.getBoolean("supported")).put("initial_voice_count",initial.getJSONArray("voices").length());
   if(!initial.getBoolean("supported"))throw new IOException("Signed production native loader unavailable");
   if(initial.getJSONArray("voices").length()==0&&"true".equals(args.getString("installPack"))){
    long start=SystemClock.elapsedRealtime();
    method(cls,"install",InputStream.class,String.class).invoke(engine,getContext().getAssets().open("private.tbvoices"),"device-pack");
    Object[] result=responses.poll(180,TimeUnit.SECONDS);if(result==null||result[2]!=null)throw new IOException("Production private pack installation failed");
    report.put("pack_install_ms",SystemClock.elapsedRealtime()-start);
   }
   JSONArray voices=new JSONObject((String)method(cls,"status").invoke(engine)).getJSONArray("voices");report.put("voice_count",voices.length());
   if(voices.length()!=15)throw new IOException("Expected fifteen installed voices");
   long started=SystemClock.elapsedRealtime();
   method(cls,"request",String.class,JSONObject.class).invoke(engine,"warm",new JSONObject().put("action","warm"));
   Object[] warm=responses.poll(180,TimeUnit.SECONDS);if(warm==null||warm[2]!=null)throw new IOException("Production model warmup failed");
   report.put("cold_warmup_ms",SystemClock.elapsedRealtime()-started);
   JSONArray outcomes=new JSONArray();report.put("voices",outcomes);
   for(int i=0;i<voices.length();i++){
    started=SystemClock.elapsedRealtime();String id=voices.getJSONObject(i).getString("id");
    method(cls,"request",String.class,JSONObject.class).invoke(engine,"speak-"+i,new JSONObject().put("action","synthesize").put("voice",id).put("text","Welcome to your private reading room.").put("kind","prose"));
    Object[] result=responses.poll(180,TimeUnit.SECONDS);if(result==null||result[2]!=null)throw new IOException("Production synthesis failed at voice index "+i);
    String ticket=((JSONObject)result[1]).getString("ticket");
    WebResourceResponse audio=(WebResourceResponse)method(cls,"serve",String.class,String.class).invoke(engine,ticket,null);
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=audio.getData()){byte[] b=new byte[8192];int n;while((n=in.read(b))!=-1){bytes.write(b,0,n);if(bytes.size()>1440044)throw new IOException("Audio bound exceeded");}}
    byte[] wav=bytes.toByteArray();boolean valid=wav.length>44&&wav[0]=='R'&&wav[1]=='I'&&wav[2]=='F'&&wav[3]=='F';int peak=0;
    for(int n=44;n+1<wav.length;n+=2){int sample=(short)((wav[n]&255)|((wav[n+1]&255)<<8));peak=Math.max(peak,Math.abs(sample));}
    JSONObject item=new JSONObject().put("voice_index",i+1).put("generation_ms",SystemClock.elapsedRealtime()-started).put("samples",Math.max(0,(wav.length-44)/2)).put("non_silent",peak>3).put("passed",valid&&peak>3);outcomes.put(item);
    Arrays.fill(wav,(byte)0);method(cls,"release",String.class).invoke(engine,ticket);
    WebResourceResponse expired=(WebResourceResponse)method(cls,"serve",String.class,String.class).invoke(engine,ticket,null);
    if(expired.getStatusCode()!=404)throw new IOException("Released audio still accessible");
    Bundle update=new Bundle();update.putString("progress","voice "+(i+1)+"/"+voices.length());sendStatus(1,update);
    if(!item.getBoolean("passed"))throw new IOException("Invalid production waveform");
   }
   report.put("released_audio_tickets_expire",true);
   Class<?> access=loader.loadClass("com.thingsbook.library.DeviceAccess");String fixture="Temporary numerical device check "+UUID.randomUUID();
   String sealed=(String)method(access,"protect",String.class).invoke(null,fixture);
   boolean keystore=!sealed.isEmpty()&&!sealed.contains(fixture)&&fixture.equals(method(access,"reveal",String.class).invoke(null,sealed));
   if(!keystore)throw new IOException("Device access Keystore round trip failed");report.put("device_access_keystore_roundtrip",true);
   method(cls,"request",String.class,JSONObject.class).invoke(engine,"cancel-probe",new JSONObject().put("action","synthesize").put("voice",voices.getJSONObject(0).getString("id")).put("text","This request must not produce a late playback callback."));
   method(cls,"stop",boolean.class).invoke(engine,false);
   if(responses.poll(3,TimeUnit.SECONDS)!=null)throw new IOException("Cancelled synthesis returned a late callback");
   report.put("cancel_discards_late_callback",true);
   report.put("all_passed",true).put("audio_written",false);
  }catch(Throwable error){try{Throwable cause=error instanceof InvocationTargetException?((InvocationTargetException)error).getTargetException():error;report.put("all_passed",false).put("failure_type",cause.getClass().getSimpleName());}catch(Exception ignored){}}
  finally{if(engine!=null&&cls!=null)try{method(cls,"close").invoke(engine);}catch(Exception ignored){}}
  Bundle result=new Bundle();result.putString("report",report.toString());finish(report.optBoolean("all_passed")?-1:0,result);
 }
}
