using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("ThingsBook")]
[assembly: AssemblyDescription("An encrypted, offline personal bookshelf")]
[assembly: AssemblyProduct("ThingsBook")]
[assembly: AssemblyVersion("1.1.1.0")]
[assembly: AssemblyFileVersion("1.1.1.0")]

internal static class Program {
    private static TcpListener listener;
    private static int port = 8765;
    private static string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ThingsBook", "BrowserData");
    private static readonly Dictionary<string, byte[]> assets = new Dictionary<string, byte[]>();
    private static bool headless;
    private static bool noOpen;
    private static string Url { get { return "http://127.0.0.1:" + port + "/"; } }
    [STAThread]
    public static void Main(string[] args) {
        foreach (string arg in args) {
            if (arg == "--headless") headless = true;
            else if (arg == "--no-open") noOpen = true;
            else if (arg.StartsWith("--port=")) port = int.Parse(arg.Substring(7));
            else if (arg.StartsWith("--profile=")) profile = Path.GetFullPath(arg.Substring(10));
        }
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try {
            foreach (string resource in Assembly.GetExecutingAssembly().GetManifestResourceNames()) {
                if (!resource.StartsWith("thingsbook~")) continue;
                string name = resource.Substring(11).Replace('~','/');
                using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource))
                using (MemoryStream output = new MemoryStream()) { input.CopyTo(output); assets["/" + name] = output.ToArray(); }
            }
            assets["/"] = assets["/index.html"];
            assets["/_thingsbook_health"] = Encoding.UTF8.GetBytes("ThingsBook/1.1.1");
            assets["/speech/status"] = Encoding.UTF8.GetBytes("{\"ready\":false,\"voices\":[]}");
            listener = new TcpListener(IPAddress.Loopback, port);
            try { listener.Start(); }
            catch (SocketException) {
                using (WebClient client = new WebClient()) {
                    client.Proxy = null;
                    if (client.DownloadString(Url + "_thingsbook_health") != "ThingsBook/1.1.1") throw new Exception("The library port is already used by another program. Close the other ThingsBook server or app, then try again.");
                }
                if (!headless) OpenLibrary();
                return;
            }
            Thread serverThread = new Thread(Serve); serverThread.IsBackground = true; serverThread.Start();
            if (headless) Application.Run();
            else { if (!noOpen) OpenLibrary(); Application.Run(new TrayContext()); }
        } catch (Exception e) {
            if (!headless) MessageBox.Show("ThingsBook could not start.\n\n" + e.Message, "ThingsBook", MessageBoxButtons.OK, MessageBoxIcon.Information);
            Environment.ExitCode = 1;
        } finally { if (listener != null) listener.Stop(); }
    }
    private static void OpenLibrary() {
        string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe");
        if (!File.Exists(edge)) edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe");
        if (!File.Exists(edge)) throw new Exception("Microsoft Edge is required for the desktop reading window. Install Edge, then open ThingsBook again.");
        Directory.CreateDirectory(profile);
        Process.Start(new ProcessStartInfo(edge, "--app=" + Url + " --user-data-dir=\"" + profile + "\" --no-first-run --disable-features=msEdgeSidebarV2") { UseShellExecute = false });
    }
    private static void Serve() {
        try { while (true) { TcpClient client = listener.AcceptTcpClient(); ThreadPool.QueueUserWorkItem(_ => Handle(client)); } }
        catch (SocketException) { }
        catch (ObjectDisposedException) { }
    }
    private static void Handle(TcpClient client) {
        using (client) {
            try {
                client.ReceiveTimeout = 4000; client.SendTimeout = 4000;
                using (NetworkStream stream = client.GetStream()) {
                    var input = new List<byte>(); int b;
                    while (input.Count < 16384 && (b = stream.ReadByte()) != -1) {
                        input.Add((byte)b); int n = input.Count;
                        if (n >= 4 && input[n-4] == 13 && input[n-3] == 10 && input[n-2] == 13 && input[n-1] == 10) break;
                    }
                    string request = Encoding.ASCII.GetString(input.ToArray());
                    string[] lines = request.Split(new [] { "\r\n" }, StringSplitOptions.None);
                    string[] parts = lines[0].Split(' ');
                    string host = "";
                    foreach (string line in lines) if (line.StartsWith("Host:", StringComparison.OrdinalIgnoreCase)) host = line.Substring(5).Trim();
                    byte[] body = Encoding.UTF8.GetBytes("Not found"); string status = "404 Not Found", mime = "text/plain; charset=utf-8";
                    bool allowed = parts.Length >= 2 && (parts[0] == "GET" || parts[0] == "HEAD") && host == "127.0.0.1:" + port;
                    string route = parts.Length >= 2 ? parts[1].Split('?')[0] : "";
                    if (allowed && assets.ContainsKey(route)) {
                        body = assets[route]; status = "200 OK";
                        mime = route.EndsWith(".css") ? "text/css; charset=utf-8" : (route.EndsWith(".js") || route.EndsWith(".mjs")) ? "text/javascript; charset=utf-8" : route.EndsWith(".wasm") ? "application/wasm" : route == "/speech/status" ? "application/json" : route == "/_thingsbook_health" ? "text/plain" : (route == "/" || route.EndsWith(".html")) ? "text/html; charset=utf-8" : "application/octet-stream";
                    }
                    byte[] header = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + "\r\nContent-Type: " + mime + "\r\nContent-Length: " + body.Length + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n");
                    stream.Write(header,0,header.Length);
                    if (parts.Length == 0 || parts[0] != "HEAD") stream.Write(body,0,body.Length);
                }
            } catch (IOException) { } catch (SocketException) { }
        }
    }
    private sealed class TrayContext : ApplicationContext {
        private readonly NotifyIcon tray;
        public TrayContext() {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open ThingsBook", null, (s,e) => OpenLibrary());
            menu.Items.Add("Exit ThingsBook", null, (s,e) => ExitThread());
            tray = new NotifyIcon { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath), Text = "ThingsBook — private reading room", ContextMenuStrip = menu, Visible = true };
            tray.DoubleClick += (s,e) => OpenLibrary();
        }
        protected override void ExitThreadCore() { tray.Visible = false; tray.Dispose(); if (listener != null) listener.Stop(); base.ExitThreadCore(); }
    }
}
