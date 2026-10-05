// PostAdmin launcher: a small window + tray icon that starts and stops the PostAdmin server
// (server\postadmin.exe) without a console window. Written for the C# 5 compiler that ships
// with .NET Framework 4.x, so it builds on any Windows machine: see scripts/build-launcher.js.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace PostAdminLauncher
{
    static class Program
    {
        public const string ShowEventName = "Local\\PostAdminLauncher.Show";

        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main(string[] args)
        {
            bool first;
            using (var mutex = new Mutex(true, "Local\\PostAdminLauncher", out first))
            {
                if (!first)
                {
                    // Already running: ask the existing instance to show its window.
                    try { EventWaitHandle.OpenExisting(ShowEventName).Set(); } catch { }
                    return;
                }
                SetProcessDPIAware();
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                bool tray = Array.IndexOf(args, "--tray") >= 0;
                Application.Run(new LauncherForm(tray));
                GC.KeepAlive(mutex);
            }
        }
    }

    static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(18, 22, 27);
        public static readonly Color Panel = Color.FromArgb(27, 33, 41);
        public static readonly Color Border = Color.FromArgb(48, 56, 65);
        public static readonly Color Text = Color.FromArgb(221, 227, 234);
        public static readonly Color Muted = Color.FromArgb(139, 152, 165);
        public static readonly Color Blue = Color.FromArgb(74, 144, 217);
        public static readonly Color Green = Color.FromArgb(46, 204, 113);
        public static readonly Color Amber = Color.FromArgb(240, 180, 41);
        public static readonly Color Red = Color.FromArgb(229, 83, 75);

        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb(
                (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }
    }

    enum ServerState { Stopped, Starting, Running }

    // Runs the server as a hidden child process inside a job object, so it dies with the launcher.
    class ServerHost
    {
        Process proc;
        bool stopping;
        readonly IntPtr job;

        public event Action<string> Line;
        public event Action<string> Ready;
        public event Action<int, bool> Exited;

        static readonly Regex ReadyRe = new Regex(@"running at (https?://\S+)", RegexOptions.IgnoreCase);

        public ServerHost()
        {
            job = Native.CreateKillOnCloseJob();
        }

        public bool Running { get { return proc != null && !proc.HasExited; } }

        public void Start(string exe)
        {
            if (Running) return;
            stopping = false;
            var psi = new ProcessStartInfo(exe, "--no-open");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = Path.GetDirectoryName(exe);

            var p = new Process();
            p.StartInfo = psi;
            p.EnableRaisingEvents = true;
            p.OutputDataReceived += (s, e) => OnLine(e.Data);
            p.ErrorDataReceived += (s, e) => OnLine(e.Data);
            p.Exited += (s, e) =>
            {
                int code = 0;
                try { code = p.ExitCode; } catch { }
                if (Exited != null) Exited(code, stopping);
            };
            p.Start();
            if (job != IntPtr.Zero) Native.AssignProcessToJobObject(job, p.Handle);
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            proc = p;
        }

        void OnLine(string text)
        {
            if (text == null || text.StartsWith("Press Ctrl+C")) return;
            if (Line != null) Line(text);
            var m = ReadyRe.Match(text);
            if (m.Success && Ready != null) Ready(m.Groups[1].Value);
        }

        public void Stop()
        {
            if (!Running) return;
            stopping = true;
            try { proc.Kill(); proc.WaitForExit(3000); } catch { }
        }
    }

    static class Native
    {
        [StructLayout(LayoutKind.Sequential)]
        struct BasicLimit
        {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters
        {
            public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct ExtendedLimit
        {
            public BasicLimit Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        static extern IntPtr CreateJobObject(IntPtr attrs, string name);

        [DllImport("kernel32.dll")]
        static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, int length);

        [DllImport("kernel32.dll")]
        public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

        [DllImport("user32.dll")]
        public static extern bool DestroyIcon(IntPtr handle);

        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        public static IntPtr CreateKillOnCloseJob()
        {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return job;
            var info = new ExtendedLimit();
            info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            SetInformationJobObject(job, 9, ref info, Marshal.SizeOf(typeof(ExtendedLimit)));
            return job;
        }
    }

    // Round power button with a pulsing glow.
    class GlowButton : Control
    {
        public Color GlowColor = Theme.Blue;
        public string Label = "START";
        public string Caption = "";
        public bool Pulse;
        public event EventHandler Pressed;

        float phase;
        bool hover, down;
        readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();

        public GlowButton()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            timer.Interval = 33;
            timer.Tick += (s, e) =>
            {
                phase += 0.06f;
                if (phase > Math.PI * 2) phase -= (float)(Math.PI * 2);
                if (Pulse || hover) Invalidate();
            };
            timer.Start();
        }

        Rectangle Disc
        {
            get
            {
                int size = Math.Min(Width, Height);
                int pad = (int)(size * 0.17);
                return new Rectangle((Width - size) / 2 + pad, (Height - size) / 2 + pad, size - 2 * pad, size - 2 * pad);
            }
        }

        bool InDisc(Point p)
        {
            Rectangle d = Disc;
            double dx = p.X - (d.X + d.Width / 2.0), dy = p.Y - (d.Y + d.Height / 2.0);
            return dx * dx + dy * dy <= (d.Width / 2.0) * (d.Width / 2.0);
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            bool h = Enabled && InDisc(e.Location);
            if (h != hover) { hover = h; Cursor = h ? Cursors.Hand : Cursors.Default; Invalidate(); }
            base.OnMouseMove(e);
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            hover = down = false; Invalidate();
            base.OnMouseLeave(e);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && hover) { down = true; Invalidate(); }
            base.OnMouseDown(e);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            bool fire = down && Enabled && InDisc(e.Location);
            down = false; Invalidate();
            if (fire && Pressed != null) Pressed(this, EventArgs.Empty);
            base.OnMouseUp(e);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.Clear(BackColor);

            Rectangle d = Disc;
            float pulse = Pulse ? (float)(0.6 + 0.4 * Math.Sin(phase)) : 0.55f;
            if (hover) pulse = Math.Min(1f, pulse + 0.3f);
            if (down) d.Inflate(-2, -2);

            // Outer glow: radial fade from the disc edge outwards.
            int spread = d.Left - (Width - Math.Min(Width, Height)) / 2;
            var outer = Rectangle.Inflate(d, spread, spread);
            using (var path = new GraphicsPath())
            {
                path.AddEllipse(outer);
                using (var glow = new PathGradientBrush(path))
                {
                    glow.CenterColor = Color.FromArgb((int)(200 * pulse), GlowColor);
                    glow.SurroundColors = new[] { Color.FromArgb(0, GlowColor) };
                    float f = (float)d.Width / outer.Width;
                    glow.FocusScales = new PointF(f, f);
                    g.FillEllipse(glow, outer);
                }
            }

            // Bright ring.
            using (var ring = new LinearGradientBrush(d, Theme.Mix(GlowColor, Color.White, 0.35f), Theme.Mix(GlowColor, Color.Black, 0.25f), 90f))
                g.FillEllipse(ring, d);

            // Dark face.
            int ringW = Math.Max(4, d.Width / 26);
            var face = Rectangle.Inflate(d, -ringW, -ringW);
            Color top = hover ? Color.FromArgb(44, 52, 63) : Color.FromArgb(37, 44, 53);
            using (var fb = new LinearGradientBrush(face, top, Color.FromArgb(20, 25, 31), 90f))
                g.FillEllipse(fb, face);
            using (var inner = new Pen(Color.FromArgb((int)(120 * pulse), GlowColor), Math.Max(1, ringW / 3)))
                g.DrawEllipse(inner, Rectangle.Inflate(face, -ringW, -ringW));

            // Power symbol.
            float cx = d.X + d.Width / 2f, cy = d.Y + d.Height * 0.40f, r = d.Width * 0.13f;
            Color iconColor = Theme.Mix(GlowColor, Color.White, 0.25f);
            using (var pen = new Pen(iconColor, Math.Max(3f, d.Width / 30f)))
            {
                pen.StartCap = pen.EndCap = LineCap.Round;
                g.DrawArc(pen, cx - r, cy - r, r * 2, r * 2, -60, 300);
                g.DrawLine(pen, cx, cy - r * 1.35f, cx, cy - r * 0.15f);
            }

            var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            using (var font = new Font("Segoe UI Semibold", d.Width / 12f, FontStyle.Bold, GraphicsUnit.Pixel))
            using (var brush = new SolidBrush(Theme.Text))
                g.DrawString(Label, font, brush, new RectangleF(d.X, d.Y + d.Height * 0.58f, d.Width, d.Height * 0.14f), fmt);
            using (var font = new Font("Segoe UI", d.Width / 22f, GraphicsUnit.Pixel))
            using (var brush = new SolidBrush(Theme.Muted))
                g.DrawString(Caption, font, brush, new RectangleF(d.X, d.Y + d.Height * 0.71f, d.Width, d.Height * 0.10f), fmt);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing) timer.Dispose();
            base.Dispose(disposing);
        }
    }

    // Glowing "PSQL" wordmark with the version underneath.
    class Logo : Control
    {
        public string Version = "";

        public Logo()
        {
            SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint |
                     ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            g.Clear(BackColor);

            float em = Height * 0.46f;
            var fmt = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            var box = new RectangleF(0, 0, Width, Height * 0.68f);
            using (var path = new GraphicsPath())
            using (var family = new FontFamily("Segoe UI"))
            {
                path.AddString("PSQL", family, (int)FontStyle.Bold, em, box, fmt);
                for (int i = 6; i >= 1; i--)
                {
                    using (var pen = new Pen(Color.FromArgb(14, Theme.Blue), i * em / 9f))
                    {
                        pen.LineJoin = LineJoin.Round;
                        g.DrawPath(pen, path);
                    }
                }
                using (var fill = new LinearGradientBrush(box, Color.White, Theme.Mix(Theme.Blue, Color.White, 0.35f), 90f))
                    g.FillPath(fill, path);
            }
            using (var font = new Font("Segoe UI", Height * 0.15f, GraphicsUnit.Pixel))
            using (var brush = new SolidBrush(Theme.Muted))
                g.DrawString("PostAdmin " + Version, font, brush, new RectangleF(0, Height * 0.66f, Width, Height * 0.30f), fmt);
        }
    }

    class LauncherForm : Form
    {
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        readonly ServerHost server = new ServerHost();
        readonly GlowButton power = new GlowButton();
        readonly Label status = new Label();
        readonly LinkLabel urlLink = new LinkLabel();
        readonly Button openBtn = new Button();
        readonly Button hideBtn = new Button();
        readonly TextBox log = new TextBox();
        readonly Logo logo = new Logo();
        readonly NotifyIcon tray = new NotifyIcon();
        readonly ContextMenuStrip menu = new ContextMenuStrip();
        readonly ToolStripMenuItem miOpen, miToggle, miShow, miStartup, miExit;
        readonly Icon appIcon;
        readonly bool startHidden;

        ServerState state = ServerState.Stopped;
        string url;
        bool openBrowserWhenReady, exiting, trayHintShown;
        IntPtr trayIconHandle = IntPtr.Zero;
        float k = 1f;

        int S(float v) { return (int)Math.Round(v * k); }

        public LauncherForm(bool hidden)
        {
            startHidden = hidden;
            try { appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { appIcon = SystemIcons.Application; }

            using (var g = CreateGraphics()) k = g.DpiX / 96f;

            Text = "PostAdmin";
            Icon = appIcon;
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = new Font("Segoe UI", 9f);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(S(380), S(610));

            var title = new Label { Text = "PostAdmin", AutoSize = true, ForeColor = Theme.Text, Location = new Point(S(20), S(16)) };
            title.Font = new Font("Segoe UI Semibold", 13f);
            var subtitle = new Label { Text = "PostgreSQL manager", AutoSize = true, ForeColor = Theme.Muted, Location = new Point(S(22), S(44)) };

            status.AutoSize = false;
            status.TextAlign = ContentAlignment.MiddleRight;
            status.Font = new Font("Segoe UI Semibold", 9f);
            status.SetBounds(S(190), S(22), S(170), S(24));

            power.BackColor = Theme.Bg;
            power.SetBounds(S(30), S(70), S(320), S(320));
            power.Pressed += (s, e) => Toggle();

            urlLink.AutoSize = false;
            urlLink.TextAlign = ContentAlignment.MiddleCenter;
            urlLink.SetBounds(S(20), S(392), S(340), S(22));
            urlLink.LinkColor = urlLink.ActiveLinkColor = Theme.Blue;
            urlLink.VisitedLinkColor = Theme.Blue;
            urlLink.DisabledLinkColor = Theme.Muted;
            urlLink.LinkBehavior = LinkBehavior.HoverUnderline;
            urlLink.LinkClicked += (s, e) => OpenBrowser();

            StyleButton(openBtn, "Open in browser", S(70), S(422), S(130));
            openBtn.Click += (s, e) => OpenBrowser();
            StyleButton(hideBtn, "Hide to tray", S(208), S(422), S(102));
            hideBtn.Click += (s, e) => HideToTray();

            log.Multiline = true;
            log.ReadOnly = true;
            log.ScrollBars = ScrollBars.None;
            log.BorderStyle = BorderStyle.None;
            log.BackColor = Theme.Panel;
            log.ForeColor = Theme.Muted;
            log.Font = new Font("Consolas", 8.5f);
            log.SetBounds(S(20), S(468), S(340), S(62));
            var logFrame = new Panel { BackColor = Theme.Panel };
            logFrame.SetBounds(S(14), S(462), S(352), S(74));

            logo.BackColor = Theme.Bg;
            logo.Version = "v" + BuildInfo.Version;
            logo.SetBounds(S(20), S(542), S(340), S(62));

            Controls.AddRange(new Control[] { title, subtitle, status, power, urlLink, openBtn, hideBtn, log, logFrame, logo });

            // Tray icon and menu.
            miOpen = new ToolStripMenuItem("Open in browser", null, (s, e) => OpenBrowser());
            miOpen.Font = new Font(menu.Font, FontStyle.Bold);
            miToggle = new ToolStripMenuItem("Start server", null, (s, e) => Toggle());
            miShow = new ToolStripMenuItem("Show window", null, (s, e) => ShowFromTray());
            miStartup = new ToolStripMenuItem("Start with Windows", null, (s, e) => ToggleStartup());
            miExit = new ToolStripMenuItem("Exit", null, (s, e) => ExitApp());
            menu.Items.AddRange(new ToolStripItem[] { miOpen, miToggle, new ToolStripSeparator(), miShow, miStartup, new ToolStripSeparator(), miExit });
            menu.Opening += (s, e) => miStartup.Checked = IsStartupEnabled();
            tray.ContextMenuStrip = menu;
            tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) ShowFromTray(); };
            tray.BalloonTipClicked += (s, e) => ShowFromTray();
            tray.Visible = true;

            server.Line += text => BeginInvokeSafe(() => AppendLog(text));
            server.Ready += u => BeginInvokeSafe(() => OnReady(u));
            server.Exited += (code, requested) => BeginInvokeSafe(() => OnExited(code, requested));

            SetState(ServerState.Stopped);
            StartServer(!startHidden);
            StartShowListener();
        }

        void StyleButton(Button b, string text, int x, int y, int w)
        {
            b.Text = text;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderColor = Theme.Border;
            b.FlatAppearance.MouseOverBackColor = Color.FromArgb(36, 44, 54);
            b.FlatAppearance.MouseDownBackColor = Color.FromArgb(44, 54, 66);
            b.BackColor = Theme.Panel;
            b.ForeColor = Theme.Text;
            b.Cursor = Cursors.Hand;
            b.SetBounds(x, y, w, S(30));
        }

        protected override void SetVisibleCore(bool value)
        {
            // Start straight in the tray for --tray (Start with Windows).
            if (startHidden && !IsHandleCreated)
            {
                CreateHandle();
                value = false;
            }
            base.SetVisibleCore(value);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int dark = 1; // Dark title bar on Windows 10 20H1+ / 11.
            try { Native.DwmSetWindowAttribute(Handle, 20, ref dark, 4); } catch { }
        }

        void BeginInvokeSafe(Action a)
        {
            if (IsDisposed) return;
            try { BeginInvoke(a); } catch (InvalidOperationException) { }
        }

        static string FindServerExe()
        {
            string dir = AppDomain.CurrentDomain.BaseDirectory;
            string self = Path.GetFullPath(Application.ExecutablePath);
            string[] candidates =
            {
                Path.Combine(dir, "server", "postadmin.exe"),
                Path.Combine(dir, "postadmin-server.exe"),
                Path.Combine(dir, "postadmin.exe"),
            };
            foreach (string c in candidates)
            {
                if (File.Exists(c) && !string.Equals(Path.GetFullPath(c), self, StringComparison.OrdinalIgnoreCase)) return c;
            }
            return null;
        }

        void Toggle()
        {
            if (state == ServerState.Stopped) StartServer(true);
            else if (state == ServerState.Running) StopServer();
        }

        void StartServer(bool openBrowser)
        {
            string exe = FindServerExe();
            if (exe == null)
            {
                AppendLog("Server executable not found next to the launcher (expected server\\postadmin.exe).");
                return;
            }
            openBrowserWhenReady = openBrowser;
            url = null;
            AppendLog("Starting server...");
            try
            {
                server.Start(exe);
                SetState(ServerState.Starting);
            }
            catch (Exception ex)
            {
                AppendLog("Could not start the server: " + ex.Message);
                SetState(ServerState.Stopped);
            }
        }

        void StopServer()
        {
            server.Stop();
        }

        void OnReady(string u)
        {
            url = u;
            SetState(ServerState.Running);
            if (openBrowserWhenReady) OpenBrowser();
            openBrowserWhenReady = false;
        }

        void OnExited(int code, bool requested)
        {
            AppendLog(requested ? "Server stopped." : "Server exited unexpectedly (code " + code + ").");
            if (!requested && !Visible)
                tray.ShowBalloonTip(4000, "PostAdmin", "The server stopped unexpectedly. Click to open the launcher.", ToolTipIcon.Warning);
            url = null;
            SetState(ServerState.Stopped);
        }

        void SetState(ServerState s)
        {
            state = s;
            Color c;
            switch (s)
            {
                case ServerState.Running:
                    c = Theme.Green;
                    power.Label = "STOP";
                    power.Caption = "Server is running";
                    status.Text = "●  Running";
                    break;
                case ServerState.Starting:
                    c = Theme.Amber;
                    power.Label = "STARTING";
                    power.Caption = "Please wait...";
                    status.Text = "●  Starting";
                    break;
                default:
                    c = Theme.Blue;
                    power.Label = "START";
                    power.Caption = "Server is stopped";
                    status.Text = "●  Stopped";
                    break;
            }
            power.GlowColor = c;
            power.Pulse = s != ServerState.Stopped;
            power.Enabled = s != ServerState.Starting;
            power.Invalidate();
            status.ForeColor = s == ServerState.Stopped ? Theme.Muted : c;

            bool running = s == ServerState.Running;
            urlLink.Text = running ? url : (s == ServerState.Starting ? "Starting..." : "Click START to run PostAdmin");
            // Dim instead of Enabled=false: WinForms draws disabled text embossed, which looks broken on dark.
            urlLink.LinkArea = running ? new LinkArea(0, urlLink.Text.Length) : new LinkArea(0, 0);
            urlLink.ForeColor = Theme.Muted;
            openBtn.ForeColor = running ? Theme.Text : Theme.Muted;
            openBtn.Cursor = running ? Cursors.Hand : Cursors.Default;
            miOpen.Enabled = running;
            miToggle.Text = running ? "Stop server" : "Start server";
            miToggle.Enabled = s != ServerState.Starting;
            UpdateTrayIcon(s == ServerState.Stopped ? Theme.Muted : c);
            string tip = "PostAdmin - " + (running ? "running at " + url : s == ServerState.Starting ? "starting" : "stopped");
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
        }

        // App icon with a small status dot in the corner.
        void UpdateTrayIcon(Color dot)
        {
            const int size = 32;
            using (var bmp = new Bitmap(size, size))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    using (var ic = new Icon(appIcon, size, size)) g.DrawIcon(ic, new Rectangle(0, 0, size, size));
                    using (var ring = new SolidBrush(Theme.Bg)) g.FillEllipse(ring, 18, 18, 14, 14);
                    using (var fill = new SolidBrush(dot)) g.FillEllipse(fill, 20, 20, 10, 10);
                }
                IntPtr h = bmp.GetHicon();
                tray.Icon = Icon.FromHandle(h);
                if (trayIconHandle != IntPtr.Zero) Native.DestroyIcon(trayIconHandle);
                trayIconHandle = h;
            }
        }

        void AppendLog(string text)
        {
            if (log.TextLength > 20000) log.Text = log.Text.Substring(log.TextLength - 10000);
            log.AppendText((log.TextLength > 0 ? Environment.NewLine : "") + text);
        }

        void OpenBrowser()
        {
            if (url == null) return;
            try { Process.Start(url); } catch (Exception ex) { AppendLog("Could not open the browser: " + ex.Message); }
        }

        void HideToTray()
        {
            Hide();
            if (!trayHintShown)
            {
                trayHintShown = true;
                tray.ShowBalloonTip(3000, "PostAdmin is still running",
                    "It keeps running in the tray. Right-click the icon to stop it or exit.", ToolTipIcon.Info);
            }
        }

        void ShowFromTray()
        {
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        void StartShowListener()
        {
            var ev = new EventWaitHandle(false, EventResetMode.AutoReset, Program.ShowEventName);
            var t = new Thread(() =>
            {
                while (true)
                {
                    ev.WaitOne();
                    BeginInvokeSafe(ShowFromTray);
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        static bool IsStartupEnabled()
        {
            using (var key = Registry.CurrentUser.OpenSubKey(RunKey))
                return key != null && key.GetValue("PostAdmin") != null;
        }

        void ToggleStartup()
        {
            try
            {
                using (var key = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (IsStartupEnabled()) key.DeleteValue("PostAdmin", false);
                    else key.SetValue("PostAdmin", "\"" + Application.ExecutablePath + "\" --tray");
                }
            }
            catch (Exception ex)
            {
                AppendLog("Could not change the startup setting: " + ex.Message);
            }
        }

        void ExitApp()
        {
            exiting = true;
            server.Stop();
            tray.Visible = false;
            Application.Exit();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // The close button hides to the tray, like Laragon. Exit from the tray menu quits.
            if (!exiting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                HideToTray();
                return;
            }
            server.Stop();
            tray.Visible = false;
            base.OnFormClosing(e);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                tray.Dispose();
                if (trayIconHandle != IntPtr.Zero) Native.DestroyIcon(trayIconHandle);
            }
            base.Dispose(disposing);
        }
    }
}
