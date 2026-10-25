package com.thingsbook.library;

import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.*;
import java.net.*;
import java.util.*;

/** Narrow, cookie-free HTTPS transport for user-initiated public OPDS requests. */
final class BookCatalog {
 static boolean allowed(String value){try{
  URI u=new URI(value);if(!"https".equals(u.getScheme())||!"www.gutenberg.org".equals(u.getHost())||u.getPort()!=-1||u.getUserInfo()!=null||u.getFragment()!=null||value.length()>1600)return false;
  String path=u.getRawPath();
  if("/ebooks/search.opds/".equals(path)){Map<String,String> params=new HashMap<>();String query=u.getRawQuery();if(query!=null&&!query.isEmpty())for(String part:query.split("&")){String[] pair=part.split("=",2);String k=URLDecoder.decode(pair[0],"UTF-8"),v=pair.length>1?URLDecoder.decode(pair[1],"UTF-8"):"";if(!Arrays.asList("query","start_index").contains(k)||params.containsKey(k))return false;params.put(k,v);}String q=params.get("query"),start=params.get("start_index");return(q==null||q.length()<=160)&&(start==null||start.matches("\\d{1,5}"));}
  if(u.getRawQuery()!=null)return false;
  return path.matches("/ebooks/[1-9]\\d{0,6}\\.(?:opds|epub\\.(?:images|noimages)|epub3\\.images|txt\\.utf-8)")||path.matches("/cache/epub/[1-9]\\d{0,6}/pg[1-9]\\d{0,6}[a-zA-Z0-9._-]*\\.(?:epub|txt)")||path.matches("/files/[1-9]\\d{0,6}/[a-zA-Z0-9._-]+\\.(?:epub|txt)");
 }catch(Exception e){return false;}}
 static WebResourceResponse response(int code,String mime,byte[] bytes){Map<String,String> h=new HashMap<>();h.put("Cache-Control","no-store");h.put("X-Content-Type-Options","nosniff");return new WebResourceResponse(mime,"UTF-8",code,code==200?"OK":"Unavailable",h,new ByteArrayInputStream(bytes));}
 static WebResourceResponse fetch(Uri outer){
  String value=outer.getQueryParameter("url");if(outer.getQueryParameterNames().size()!=1||value==null||!allowed(value))return response(403,"text/plain",new byte[0]);
  long deadline=System.currentTimeMillis()+45000;
  try{for(int hop=0;hop<5;hop++){
   if(!allowed(value)||System.currentTimeMillis()>deadline)throw new IOException();
   HttpURLConnection c=(HttpURLConnection)new URL(value).openConnection();c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(15000);c.setUseCaches(false);c.setRequestProperty("User-Agent","ThingsBook/1.11.0 (user-initiated OPDS reader)");c.setRequestProperty("Accept","application/atom+xml, application/epub+zip, text/plain");
   try{int status=c.getResponseCode();if(Arrays.asList(301,302,303,307,308).contains(status)){String location=c.getHeaderField("Location");if(location==null)throw new IOException();value=new URL(new URL(value),location).toString();continue;}if(status!=200)throw new IOException();
    boolean feed=new URL(value).getPath().contains(".opds");int limit=feed?2*1024*1024:32*1024*1024;if(c.getContentLengthLong()>limit)throw new IOException();
    try(InputStream in=c.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[32768];try{int read;while((read=in.read(buffer))!=-1){if(System.currentTimeMillis()>deadline||out.size()+read>limit)throw new IOException();out.write(buffer,0,read);}return response(200,feed?"application/atom+xml":"application/octet-stream",out.toByteArray());}finally{Arrays.fill(buffer,(byte)0);}}
   }finally{c.disconnect();}
  }}catch(Exception e){}
  return response(502,"text/plain","Download unavailable, timed out or over the32 MB limit. Your library was not changed.".getBytes(java.nio.charset.StandardCharsets.UTF_8));
 }
}
