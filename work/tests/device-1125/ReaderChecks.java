package com.thingsbook.devicechecks;
import android.app.*;import android.content.*;import android.os.*;import android.webkit.*;import android.view.MotionEvent;import org.json.*;import java.lang.reflect.*;import java.nio.charset.StandardCharsets;import java.io.*;import java.util.concurrent.*;
/** Exercises the real signed app WebView without enabling remote debugging. */
public final class ReaderChecks extends Instrumentation {
 @Override public void onCreate(Bundle b){super.onCreate(b);start();}
 private String js(WebView w,String source)throws Exception{BlockingQueue<String> q=new LinkedBlockingQueue<>();runOnMainSync(()->w.evaluateJavascript(source,v->q.offer(v)));String s=q.poll(15,TimeUnit.SECONDS);if(s==null)throw new IOException("WebView callback timeout");return s;}
 @Override public void onStart(){JSONObject report=new JSONObject();Activity activity=null;WebView web=null;try{
  activity=startActivitySync(new Intent().setComponent(new ComponentName("com.thingsbook.library","com.thingsbook.library.MainActivity")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  Field f=activity.getClass().getDeclaredField("web");f.setAccessible(true);web=(WebView)f.get(activity);WebView settingsTarget=web;boolean[] requiresGesture=new boolean[1];runOnMainSync(()->requiresGesture[0]=settingsTarget.getSettings().getMediaPlaybackRequiresUserGesture());report.put("media_gesture_required",requiresGesture[0]);
  long deadline=SystemClock.elapsedRealtime()+30000;while(!"true".equals(js(web,"typeof ThingsReader !== 'undefined' && typeof ThingsAndroidNeural !== 'undefined'"))){if(SystemClock.elapsedRealtime()>deadline)throw new IOException("Reader initialization timeout");Thread.sleep(150);}
  report.put("initial",new JSONObject(new JSONTokener(js(web,"JSON.stringify({unlocked:typeof key!=='undefined'&&!!key,loaded_book_count:typeof books!=='undefined'?books.length:-1,personal:JSON.parse(ThingsBookAndroid.personalStatus()).voices.length})")).nextValue().toString()));
  String script;try(InputStream in=getContext().getAssets().open("reader-checks.js")){ByteArrayOutputStream b=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;while((n=in.read(buf))!=-1)b.write(buf,0,n);script=new String(b.toByteArray(),StandardCharsets.UTF_8);}
  js(web,script);deadline=SystemClock.elapsedRealtime()+180000;
  boolean tapped=false;
  while(SystemClock.elapsedRealtime()<deadline){Object v=new JSONTokener(js(web,"JSON.stringify(window.__deviceChecks||{})")).nextValue();JSONObject state=new JSONObject(v.toString());
   if(state.optBoolean("waiting_for_tap")&&!tapped){JSONObject p=new JSONObject(new JSONTokener(js(web,"JSON.stringify((()=>{const r=document.getElementById('narrator-play').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:innerWidth}})())")).nextValue().toString());int[] pos=new int[2];WebView target=web;runOnMainSync(()->target.getLocationOnScreen(pos));float scale=web.getWidth()/(float)p.getDouble("width"),x=pos[0]+(float)p.getDouble("x")*scale,y=pos[1]+(float)p.getDouble("y")*scale;long at=SystemClock.uptimeMillis();MotionEvent down=MotionEvent.obtain(at,at,MotionEvent.ACTION_DOWN,x,y,0),up=MotionEvent.obtain(at,at+80,MotionEvent.ACTION_UP,x,y,0);try{sendPointerSync(down);sendPointerSync(up);}finally{down.recycle();up.recycle();}tapped=true;}
   if(state.optBoolean("finished")){report.put("reader",state);report.put("all_passed",state.optBoolean("passed"));break;}Thread.sleep(250);}
  if(!report.has("reader"))throw new IOException("Reader check timeout");
 }catch(Throwable error){try{report.put("all_passed",false).put("failure_type",error.getClass().getSimpleName());}catch(Exception ignored){}}
 finally{if(web!=null)try{js(web,"(async()=>{if(ThingsReader.active())await ThingsReader.close();document.getElementById('reader-dialog').close();})()");}catch(Exception ignored){}}
 Bundle result=new Bundle();result.putString("report",report.toString());finish(report.optBoolean("all_passed")?-1:0,result);
 }
}
