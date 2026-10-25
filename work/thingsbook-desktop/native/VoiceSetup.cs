using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;

[assembly:AssemblyTitle("ThingsBook Personal Voice Setup")]
[assembly:AssemblyVersion("1.0.0.0")]
internal sealed class VoiceSetup : Form {
  readonly string root = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
  readonly Button install = new Button { Text="2. Choose downloaded model and prepare both voices", AutoSize=true };
  readonly TextBox log = new TextBox { Multiline=true, ReadOnly=true, ScrollBars=ScrollBars.Vertical, Dock=DockStyle.Fill, Font=new Font("Consolas",10) };
  readonly ProgressBar progress = new ProgressBar { Dock=DockStyle.Bottom, Height=18 };
  Process worker;
  const string ModelUrl="https://huggingface.co/kyutai/pocket-tts/blob/983151f13aaeab1b13c1e5e3c2c383d49a9edf3f/languages/english/model.safetensors";

  [STAThread] static void Main() {
    Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new VoiceSetup());
  }
  VoiceSetup() {
    Text="ThingsBook - Your two personal reading voices"; Width=760; Height=560; MinimumSize=new Size(640,460);
    StartPosition=FormStartPosition.CenterScreen; BackColor=Color.FromArgb(247,245,239); Font=new Font("Segoe UI",10);
    var heading=new Label { Text="Always & Forever  /  Amazing Voice", Font=new Font("Segoe UI",18,FontStyle.Bold), AutoSize=true };
    var description=new Label { Text="One-time private setup. Download the official model with your approved Hugging Face account,\nthen choose that file below. Your recordings and books stay on this computer.\nNo token is needed in this window. Model download: about 219 MB.", AutoSize=true, Padding=new Padding(0,8,0,8) };
    var download=new Button { Text="1. Open official model download page", AutoSize=true };
    download.Click+=(s,e)=>{ try { Process.Start(new ProcessStartInfo(ModelUrl){UseShellExecute=true}); } catch { MessageBox.Show(ModelUrl,"Open this official address in your browser"); } };
    install.Click+=(s,e)=>ChooseModel();
    var panel=new FlowLayoutPanel { Dock=DockStyle.Top, Height=230, Padding=new Padding(18), FlowDirection=FlowDirection.TopDown, WrapContents=false };
    panel.Controls.Add(heading);panel.Controls.Add(description);panel.Controls.Add(download);panel.Controls.Add(install);
    Controls.Add(log);Controls.Add(panel);Controls.Add(progress);
    log.Text="Your existing library is not changed.\r\nClose narration in ThingsBook before installation.\r\nThe setup verifies the exact official model, generates both reading previews,\r\nand installs a voice pack for ThingsBook Windows 1.9.0.\r\nA previous voice pack is retained if installation fails.\r\nAndroid needs a separate compatible on-device voice engine.\r\n";
    FormClosing+=(s,e)=>{ if(worker!=null&&!worker.HasExited) { e.Cancel=true; MessageBox.Show("Voice preparation is still running. Keep this window open until it completes.","Preparing voices"); } };
  }
  void Append(string value) { if(value==null||IsDisposed)return; if(InvokeRequired){BeginInvoke(new Action<string>(Append),value);return;}log.AppendText(value+Environment.NewLine); }
  void ChooseModel() {
    if(worker!=null&&!worker.HasExited)return;
    using(var picker=new OpenFileDialog { Title="Choose the official Kyutai model.safetensors", Filter="Safetensors model|*.safetensors", InitialDirectory=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),"Downloads") }) {
      if(picker.ShowDialog(this)!=DialogResult.OK)return;
      string python=Path.Combine(root,"runtime","python.exe"),script=Path.Combine(root,"voice-setup.py");
      if(!File.Exists(python)||!File.Exists(script)){MessageBox.Show("Keep this setup EXE inside the ThingsBook-Speech folder with its runtime and voice-setup.py.");return;}
      var info=new ProcessStartInfo(python) { Arguments="-u \""+script+"\" --install --weights \""+picker.FileName+"\"", WorkingDirectory=root, UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8 };
      info.EnvironmentVariables["PYTHONIOENCODING"]="utf-8";
      worker=new Process { StartInfo=info,EnableRaisingEvents=true };
      worker.OutputDataReceived+=(s,e)=>Append(e.Data);worker.ErrorDataReceived+=(s,e)=>Append(e.Data);
      worker.Exited+=(s,e)=>{ int code=worker.ExitCode;BeginInvoke(new Action(()=>{ install.Enabled=true;progress.Style=ProgressBarStyle.Blocks;progress.Value=code==0?100:0;Append(code==0?"READY: Open a book in ThingsBook and select Always & Forever or Amazing Voice in Voice. Listen to the generated previews to judge the match.":"NOT INSTALLED: Read the message above. Your existing library and previous voice pack are unchanged."); })); };
      install.Enabled=false;progress.Style=ProgressBarStyle.Marquee;
      Append("Verifying model and preparing both voices. This can take several minutes...");
      try{worker.Start();worker.BeginOutputReadLine();worker.BeginErrorReadLine();}
      catch{worker=null;install.Enabled=true;progress.Style=ProgressBarStyle.Blocks;Append("Could not start the bundled voice runtime.");}
    }
  }
}
