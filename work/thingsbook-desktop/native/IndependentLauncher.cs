using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading;
using System.Windows.Forms;
[assembly:AssemblyTitle("ThingsBook Independent Desktop")]
[assembly:AssemblyProduct("ThingsBook")]
[assembly:AssemblyVersion("1.14.3.0")]
[assembly:AssemblyFileVersion("1.14.3.0")]
internal static class IndependentLauncher {
 const string Version="1.14.3";
 [STAThread] static void Main(){
  Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
  string baseRoot=Environment.GetEnvironmentVariable("THINGSBOOK_TEST_RUNTIME");
  if(String.IsNullOrEmpty(baseRoot))baseRoot=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ThingsBookDesktop","Runtime");
  string runtime=Path.Combine(baseRoot,Version),target=Path.Combine(runtime,"ThingsBook.exe");
  try{
   Directory.CreateDirectory(baseRoot);
   using(var mutex=new Mutex(false,"Local\\ThingsBookIndependentRuntime1125")){
    if(!mutex.WaitOne(TimeSpan.FromMinutes(2)))throw new Exception("ThingsBook is preparing its runtime in another window. Try again shortly.");
    try{
     if(!File.Exists(Path.Combine(runtime,".complete"))||!File.Exists(target)){
      using(var form=new Form {Text="Preparing ThingsBook",Width=400,Height=150,StartPosition=FormStartPosition.CenterScreen,FormBorderStyle=FormBorderStyle.FixedDialog,ControlBox=false})
      using(var label=new Label {Text="Preparing your private reading room…",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,Font=new Font("Segoe UI",11)})
      using(var bar=new ProgressBar {Dock=DockStyle.Bottom,Height=22}){
       form.Controls.Add(label);form.Controls.Add(bar);if(Environment.GetEnvironmentVariable("THINGSBOOK_TEST_HIDDEN")!="1")form.Show();
       Directory.CreateDirectory(runtime);
       // Chromium's sandbox needs read access to public runtime files only.
       var access=Directory.GetAccessControl(runtime);
       bool package=false,allPackages=false;
       foreach(FileSystemAccessRule rule in access.GetAccessRules(true,true,typeof(SecurityIdentifier))){string sid=rule.IdentityReference.Value;if(sid=="S-1-15-2-1")allPackages=true;else if(sid.StartsWith("S-1-15-2-"))package=true;}
       if(package&&!allPackages){access.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-15-2-1"),FileSystemRights.ReadAndExecute,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));Directory.SetAccessControl(runtime,access);}
       string checkedRoot=Path.GetFullPath(runtime)+Path.DirectorySeparatorChar;
       using(Stream input=Assembly.GetExecutingAssembly().GetManifestResourceStream("thingsbook.runtime.zip"))
       using(var zip=new ZipArchive(input,ZipArchiveMode.Read)){
        bar.Maximum=zip.Entries.Count;int count=0;
        foreach(var entry in zip.Entries){
         string destination=Path.GetFullPath(Path.Combine(runtime,entry.FullName.Replace('/',Path.DirectorySeparatorChar)));
         if(!destination.StartsWith(checkedRoot,StringComparison.OrdinalIgnoreCase))throw new Exception("Invalid bundled runtime path.");
         if(entry.FullName.EndsWith("/"))Directory.CreateDirectory(destination);else{Directory.CreateDirectory(Path.GetDirectoryName(destination));using(var source=entry.Open())using(var output=new FileStream(destination,FileMode.Create,FileAccess.Write,FileShare.None))source.CopyTo(output);}
         bar.Value=++count;Application.DoEvents();
        }
       }
       File.WriteAllText(Path.Combine(runtime,".complete"),Version);form.Close();
      }
     }
    }finally{mutex.ReleaseMutex();}
   }
   Process.Start(new ProcessStartInfo(target) {UseShellExecute=false,WorkingDirectory=runtime});
  }catch(Exception error){if(Environment.GetEnvironmentVariable("THINGSBOOK_TEST_HIDDEN")!="1")MessageBox.Show(error.Message,"ThingsBook could not start",MessageBoxButtons.OK,MessageBoxIcon.Information);Environment.ExitCode=1;}
 }
}
