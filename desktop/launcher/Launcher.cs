// The built app's "UGC Music Studio.exe" (phase 8, tools/build-exe.js) - what the person starts: it runs
// app\UGC Music Studio.exe (Electron with the program in app\resources\app) and goes. The library is
// "UGC Music Studio\library", beside this file (desktop/main.js finds it from the program's own place).
// Compiled by Windows' own csc.exe (C# 5, .NET Framework 4) with the app's icon.

using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

static class Launcher
{
    [STAThread]
    static void Main(string[] args)
    {
        string top = AppDomain.CurrentDomain.BaseDirectory;
        string exe = Path.Combine(top, "app", "UGC Music Studio.exe");
        if (!File.Exists(exe))
        {
            MessageBox.Show("The folder \"app\" is missing beside this file.\n\nUnpack the whole ZIP of UGC Music Studio again.",
                "UGC Music Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var psi = new ProcessStartInfo(exe)
        {
            WorkingDirectory = Path.Combine(top, "app"),
            UseShellExecute = false,
            Arguments = string.Join(" ", args.Select(a => "\"" + a.Replace("\"", "\\\"") + "\"")),
        };
        try { Process.Start(psi); }
        catch (Exception e)
        {
            MessageBox.Show("UGC Music Studio could not start:\n\n" + e.Message, "UGC Music Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
