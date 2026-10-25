mod audio; mod config; mod defaults; mod download; mod model; mod rng; mod text; mod tokenizer; mod weights;
use std::sync::{Mutex,atomic::{AtomicBool,AtomicU64,Ordering}};
use jni::{JNIEnv,objects::{JClass,JString,JByteArray},sys::{jboolean,jfloatArray,jlong}};
type Model=model::TtsModel<xn::Unquantized<f32,xn::CpuDevice>>;
static ENGINE:Mutex<Option<Model>>=Mutex::new(None);
static GENERATION:AtomicU64=AtomicU64::new(0);
static STOP:AtomicBool=AtomicBool::new(false);
fn failure(env:&mut JNIEnv,e:impl std::fmt::Display){let _=env.throw_new("java/lang/IllegalStateException",e.to_string());}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_thingsbook_library_PersonalVoices_load(mut env:JNIEnv,_:JClass,dir:JString)->jboolean{
 let r=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||->anyhow::Result<()>{
  let dir:String=env.get_string(&dir)?.into(); let dir=std::path::Path::new(&dir).canonicalize()?;
  let path=dir.join("config.yaml");
  let (mut conf,origin)=config::Config::load(None,Some(path.to_str().ok_or_else(||anyhow::anyhow!("Invalid path"))?))?;
  conf.weights_path=Some(dir.join("model.safetensors").to_string_lossy().into_owned());
  conf.weights_path_without_voice_cloning=None;
  conf.flow_lm.lookup_table.tokenizer_path=dir.join("tokenizer.json").to_string_lossy().into_owned();
  let m=Model::load(conf,origin,&model::LoadOptions::default())?;
  *ENGINE.lock().map_err(|_|anyhow::anyhow!("Engine lock poisoned"))?=Some(m); Ok(())
 }));
 match r {Ok(Ok(()))=>1,Ok(Err(e))=>{failure(&mut env,e);0},Err(_)=>{failure(&mut env,"Voice engine panicked");0}}
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_thingsbook_library_PersonalVoices_synthesize(mut env:JNIEnv,_:JClass,text:JString,voice:JByteArray,epoch:jlong)->jfloatArray{
 let r=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||->anyhow::Result<jfloatArray>{
  let text:String=env.get_string(&text)?.into(); let mut voice=env.convert_byte_array(&voice)?;
  if text.chars().count()>600 || text.trim().is_empty(){anyhow::bail!("Use a nonempty text segment of at most 600 characters");}
  STOP.store(false,Ordering::SeqCst);
  if GENERATION.load(Ordering::SeqCst)!=epoch as u64 {STOP.store(true,Ordering::SeqCst);anyhow::bail!("Speech cancelled before start");}
  let lock=ENGINE.lock().map_err(|_|anyhow::anyhow!("Engine lock poisoned"))?; let m=lock.as_ref().ok_or_else(||anyhow::anyhow!("Voice engine not loaded"))?;
  let state=m.import_state_bytes(&voice);voice.fill(0);let state=state?; let mut pcm=Vec::new();
  m.generate_audio_stream(&state,&text,80,None,&STOP,&mut |chunk|{
   if GENERATION.load(Ordering::SeqCst)!=epoch as u64 {STOP.store(true,Ordering::SeqCst);anyhow::bail!("Speech cancelled");}
   if pcm.len()+chunk.len()>720000 {STOP.store(true,Ordering::SeqCst);anyhow::bail!("Speech segment exceeds 30 second audio limit");}
   pcm.extend_from_slice(chunk); Ok(())
  })?;
  if STOP.load(Ordering::SeqCst){anyhow::bail!("Speech cancelled");}
  let out=env.new_float_array(pcm.len() as i32)?; env.set_float_array_region(&out,0,&pcm)?; pcm.fill(0.); Ok(out.into_raw())
 }));
 match r {Ok(Ok(v))=>v,Ok(Err(e))=>{failure(&mut env,e);std::ptr::null_mut()},Err(_)=>{failure(&mut env,"Voice engine panicked");std::ptr::null_mut()}}
}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_thingsbook_library_PersonalVoices_generation(_:JNIEnv,_:JClass)->jlong{GENERATION.load(Ordering::SeqCst) as jlong}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_thingsbook_library_PersonalVoices_cancel(_:JNIEnv,_:JClass){GENERATION.fetch_add(1,Ordering::SeqCst);STOP.store(true,Ordering::SeqCst);}
#[unsafe(no_mangle)]
pub extern "system" fn Java_com_thingsbook_library_PersonalVoices_dispose(_:JNIEnv,_:JClass){STOP.store(true,Ordering::SeqCst);if let Ok(mut e)=ENGINE.lock(){*e=None;}}

/// Host-only compatibility probe; never writes voice contents or synthesized audio.
pub fn compatibility_probe(dir:&str, voice:&str)->anyhow::Result<serde_json::Value>{
 let start=std::time::Instant::now();
 let base=std::path::Path::new(dir).canonicalize()?;
 let (mut c,o)=config::Config::load(None,Some(base.join("config.yaml").to_str().unwrap()))?;
 c.weights_path=Some(base.join("model.safetensors").to_string_lossy().into_owned());
 c.weights_path_without_voice_cloning=None;
 c.flow_lm.lookup_table.tokenizer_path=base.join("tokenizer.json").to_string_lossy().into_owned();
 let m=Model::load(c,o,&model::LoadOptions::default())?; let loaded=start.elapsed().as_millis();
 let mut private_state=std::fs::read(voice)?;let state=m.import_state_bytes(&private_state);private_state.fill(0);let state=state?; let mut count=0usize; let mut peak=0f32; let mut finite=true;
 let stop=AtomicBool::new(false);
 m.generate_audio_stream(&state,"Welcome to your private reading room.",80,None,&stop,&mut |chunk|{count+=chunk.len(); for x in chunk {finite &= x.is_finite();peak=peak.max(x.abs());} if count>720000{anyhow::bail!("Probe audio limit");} Ok(())})?;
 Ok(serde_json::json!({"model_load_ms":loaded,"elapsed_ms":start.elapsed().as_millis(),"sample_rate":m.sample_rate(),"samples":count,"all_finite":finite,"non_silent":peak>0.0001,"audio_written":false}))
}
