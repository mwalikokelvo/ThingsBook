using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Speech.Synthesis;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Threading;
internal static class SpeechBridge {
 [STAThread] static int Main(string[] args){
  try{
   using(var synth=new SpeechSynthesizer()){
    if(args.Length==1&&args[0]=="--voices"){
     var list=synth.GetInstalledVoices().Where(v=>v.Enabled).Select(v=>new {id=v.VoiceInfo.Name,name=v.VoiceInfo.Name,language=v.VoiceInfo.Culture.Name}).ToArray();
     byte[] json=Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(list));Console.OpenStandardOutput().Write(json,0,json.Length);return 0;
    }
    if(args.Length!=1||args[0]!="--synthesize")return 2;
    string input=new StreamReader(Console.OpenStandardInput(),Encoding.UTF8).ReadLine();if(input==null||input.Length>32000)return 2;
    var request=new JavaScriptSerializer().Deserialize<Dictionary<string,string>>(input);
    if(!request.ContainsKey("text")||!request.ContainsKey("voice")||request["text"].Length>4000)return 2;
    if(!synth.GetInstalledVoices().Any(v=>v.Enabled&&v.VoiceInfo.Name==request["voice"]))return 2;
    synth.SelectVoice(request["voice"]);
    using(var audio=new MemoryStream())using(var completed=new ManualResetEvent(false)){Exception failure=null;synth.SpeakCompleted+=(sender,eventArgs)=>{failure=eventArgs.Error;completed.Set();};synth.SetOutputToWaveStream(audio);synth.SpeakAsync(request["text"]);if(!completed.WaitOne(TimeSpan.FromSeconds(60)))Environment.Exit(3);if(failure!=null)return 1;synth.SetOutputToNull();byte[] bytes=audio.ToArray();Console.OpenStandardOutput().Write(bytes,0,bytes.Length);}
    return 0;
   }
  }catch{Console.Error.WriteLine("Offline speech failed.");return 1;}
 }
}
