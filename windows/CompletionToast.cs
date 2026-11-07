using System;
using System.Collections.Generic;
using System.Security;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

// 只在所属 Pi 会话存活期间处理通知点击，无自定义协议、网络监听或任意命令执行。
class CompletionToast {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  static extern int SetCurrentProcessExplicitAppUserModelID(string id);
  [DllImport("user32.dll")]
  static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")]
  static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  static extern int GetClassName(IntPtr hWnd, StringBuilder name, int count);
  static readonly object sync = new object();
  static readonly JavaScriptSerializer json = new JavaScriptSerializer();
  static void Emit(string kind, string id) {
    lock(sync) { Console.WriteLine(json.Serialize(new { kind = kind, id = id })); Console.Out.Flush(); }
  }
  static bool IsWindowsTerminalWindow(IntPtr hwnd) {
    if (hwnd == IntPtr.Zero) return false;
    var name = new StringBuilder(256);
    if (GetClassName(hwnd, name, name.Capacity) <= 0) return false;
    return string.Equals(name.ToString(), "CASCADIA_HOSTING_WINDOW_CLASS", StringComparison.Ordinal);
  }
  [MTAThread]
  static int Main() {
    Console.InputEncoding = new UTF8Encoding(false);
    Console.OutputEncoding = new UTF8Encoding(false);
    ToastNotifier notifier = null;
    ToastNotification toast = null;
    var done = new ManualResetEvent(false);
    try {
      string line = Console.ReadLine();
      if(line == null || line.Length > 8192) return 2;
      var input = json.Deserialize<Dictionary<string, object>>(line);
      string id = Convert.ToString(input["id"]);
      Guid parsed;
      if(!Guid.TryParse(id, out parsed)) return 2;
      long deadline = Convert.ToInt64(input["deadline"]);
      long remaining = deadline - DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
      if(remaining <= 0 || remaining > 600000) return 2;
      IntPtr focusHwnd = IntPtr.Zero;
      object focusValue;
      if(input.TryGetValue("focusHwnd", out focusValue)) {
        long rawHandle;
        if(long.TryParse(Convert.ToString(focusValue), out rawHandle) && rawHandle > 0) focusHwnd = new IntPtr(rawHandle);
      }
      SetCurrentProcessExplicitAppUserModelID("Pi.CompletionNotify");
      notifier = ToastNotificationManager.CreateToastNotifier("Pi.CompletionNotify");
      var xml = new XmlDocument();
      xml.LoadXml("<toast duration=\"long\" launch=\"open\"><visual><binding template=\"ToastGeneric\"><text>" +
        SecurityElement.Escape(Convert.ToString(input["title"])) + "</text><text>" +
        SecurityElement.Escape(Convert.ToString(input["body"])) +
        "</text></binding></visual><actions><action content=\"打开对应终端\" arguments=\"open\" activationType=\"foreground\"/></actions></toast>");
      toast = new ToastNotification(xml);
      toast.Tag = id.Replace("-", "").Substring(0, 16);
      toast.Group = "PiCompletion";
      toast.ExpirationTime = DateTimeOffset.FromUnixTimeMilliseconds(deadline);
      toast.Activated += (sender, args) => {
        var value = args as ToastActivatedEventArgs;
        if(value == null || value.Arguments != "open") return;
        if(IsWindowsTerminalWindow(focusHwnd)) {
          ShowWindow(focusHwnd, 3);
          SetForegroundWindow(focusHwnd);
        }
        Emit("open", id);
      };
      toast.Failed += (sender, args) => { Emit("error", id); done.Set(); };
      var reader = new Thread(() => { try { Console.ReadLine(); } catch {} finally { done.Set(); } });
      reader.IsBackground = true;
      reader.Start();
      notifier.Show(toast);
      Emit("ready", id);
      done.WaitOne((int)remaining);
      return 0;
    } catch {
      try { Emit("error", ""); } catch {}
      return 1;
    } finally {
      try { if(notifier != null && toast != null) notifier.Hide(toast); } catch {}
      try { if(toast != null) ToastNotificationManager.History.Remove(toast.Tag, toast.Group, "Pi.CompletionNotify"); } catch {}
    }
  }
}
