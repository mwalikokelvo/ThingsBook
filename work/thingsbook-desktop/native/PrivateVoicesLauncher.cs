using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Threading;
using System.Windows.Forms;
[assembly:AssemblyTitle("ThingsBook Private Personal Voices")]
[assembly:AssemblyVersion("1.9.5.0")]
internal static class PrivateVoicesLauncher {
 static string LongPath(string path){string full=Path.GetFullPath(path);if(full.StartsWith(@"\\?\"))return full;return full.StartsWith(@"\\")?@"\\?\UNC\"+full.Substring(2):@"\\?\"+full;}
 static string NormalPath(string path){return path.StartsWith(@"\\?\UNC\")?@"\\"+path.Substring(8):path.StartsWith(@"\\?\")?path.Substring(4):path;}
 static string Hash(string path){using(var sha=SHA256.Create())using(var stream=File.OpenRead(path))return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
 static void PrivateDirectory(string path){
  Directory.CreateDirectory(path);var acl=new DirectorySecurity();acl.SetAccessRuleProtection(true,false);
  var rights=FileSystemRights.FullControl;var inherit=InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit;
  acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,rights,inherit,PropagationFlags.None,AccessControlType.Allow));
  acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-18"),rights,inherit,PropagationFlags.None,AccessControlType.Allow));
  acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-5-32-544"),rights,inherit,PropagationFlags.None,AccessControlType.Allow));
  Directory.SetAccessControl(path,acl);
 }
 [STAThread] static void Main(){
  // Per-process .NET path handling; do not change Windows or security policy.
  AppContext.SetSwitch("Switch.System.IO.UseLegacyPathHandling",false);
  AppContext.SetSwitch("Switch.System.IO.BlockLongPaths",false);
  Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
  string profile=Environment.GetEnvironmentVariable("THINGSBOOK_TEST_PROFILE");
  if(String.IsNullOrEmpty(profile))profile=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ThingsBookDesktop");
  string privateRoot=LongPath(Path.Combine(profile,"PrivateInstall")),pack=LongPath(Path.Combine(profile,"VoicePack")),stage=null;
  try{
   PrivateDirectory(privateRoot);
   using(var mutex=new Mutex(false,"Local\\ThingsBookPrivateVoices195")){
    if(!mutex.WaitOne(TimeSpan.FromMinutes(5)))throw new Exception("Another ThingsBook window is preparing the personal voices. Please try again shortly.");
    try{
     using(var form=new Form{Text="ThingsBook — Your personal voices",Width=460,Height=170,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,ControlBox=false})
     using(var label=new Label{Text="Preparing your 15 personal reading voices.\nEverything stays on this computer.",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Segoe UI",11)})
     using(var bar=new ProgressBar{Dock=DockStyle.Bottom,Height=22}){
      form.Controls.Add(label);form.Controls.Add(bar);
      if(Environment.GetEnvironmentVariable("THINGSBOOK_TEST_HIDDEN")!="1")form.Show();
      using(var input=Assembly.GetExecutingAssembly().GetManifestResourceStream("thingsbook.private.zip"))
      using(var zip=new ZipArchive(input,ZipArchiveMode.Read)){
       string manifest;using(var reader=new StreamReader(zip.GetEntry("manifest.tsv").Open()))manifest=reader.ReadToEnd();
       bool ready=File.Exists(Path.Combine(pack,".bundled-1.9.5"));
       // First install hashes every file. Relaunch verifies core model/voices/runtime entry points, avoiding 19,000 dependency rehashes.
       if(ready){foreach(string line in manifest.Split('\n')){if(String.IsNullOrWhiteSpace(line))continue;var parts=line.TrimEnd('\r').Split('\t');if(!parts[1].StartsWith("VoicePack/"))continue;string name=parts[1];if(!(name.StartsWith("VoicePack/models/")||name.StartsWith("VoicePack/voices/")||name=="VoicePack/ready.json"||name=="VoicePack/runtime/python.exe"||name=="VoicePack/runtime/python312.dll"||name=="VoicePack/runtime/python312._pth"))continue;var file=Path.Combine(pack,parts[1].Substring(10).Replace('/',Path.DirectorySeparatorChar));if(!File.Exists(file)||Hash(file)!=parts[0]){ready=false;break;}}}
       stage=Path.Combine(privateRoot,"staging-"+Guid.NewGuid().ToString("N"));PrivateDirectory(stage);
       bar.Maximum=zip.Entries.Count;int count=0;
       foreach(var entry in zip.Entries){
        if(entry.FullName=="manifest.tsv"||(ready&&entry.FullName.StartsWith("VoicePack/"))){bar.Value=++count;continue;}
        string dest=Path.GetFullPath(Path.Combine(stage,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
        if(!dest.StartsWith(Path.GetFullPath(stage)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new Exception("Invalid personal bundle path.");
        Directory.CreateDirectory(Path.GetDirectoryName(dest));using(var source=entry.Open())using(var output=File.Create(dest))source.CopyTo(output);
        bar.Value=++count;Application.DoEvents();
       }
       foreach(string line in manifest.Split('\n')){
        if(String.IsNullOrWhiteSpace(line))continue;var parts=line.TrimEnd('\r').Split('\t');
        if(ready&&parts[1].StartsWith("VoicePack/"))continue;
        if(Hash(Path.Combine(stage,parts[1].Replace('/',Path.DirectorySeparatorChar)))!=parts[0])throw new Exception("The bundled voices failed verification. Your previous voices were kept.");
       }
       if(!ready){
        string old=pack+".previous-"+Guid.NewGuid().ToString("N");bool had=Directory.Exists(pack);
        if(had)Directory.Move(pack,old);
        try{Directory.Move(Path.Combine(stage,"VoicePack"),pack);File.WriteAllText(Path.Combine(pack,".bundled-1.9.5"),"Verified private voice bundle");}
        catch{if(had&&!Directory.Exists(pack))Directory.Move(old,pack);throw;}
       }
       string exe=Path.Combine(stage,"ThingsBook.exe");
       if(Environment.GetEnvironmentVariable("THINGSBOOK_PRIVATE_INSTALL_ONLY")!="1")Process.Start(new ProcessStartInfo(NormalPath(exe)){UseShellExecute=false,WorkingDirectory=NormalPath(stage)});
       string report=Environment.GetEnvironmentVariable("THINGSBOOK_PRIVATE_RESULT");if(!String.IsNullOrEmpty(report))File.WriteAllText(report,"verified");
      }
      form.Close();
     }
    }finally{mutex.ReleaseMutex();}
   }
  }catch(Exception error){string report=Environment.GetEnvironmentVariable("THINGSBOOK_PRIVATE_RESULT");if(!String.IsNullOrEmpty(report))File.WriteAllText(report,error.ToString());if(Environment.GetEnvironmentVariable("THINGSBOOK_TEST_HIDDEN")!="1")MessageBox.Show(error.Message,"ThingsBook personal voices",MessageBoxButtons.OK,MessageBoxIcon.Information);Environment.ExitCode=1;}
 }
}
