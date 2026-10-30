using System;
using System.Collections.Specialized;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 1) return 2;
        StringCollection files = new StringCollection();
        string[] lines = File.ReadAllLines(args[0], Encoding.UTF8);
        for (int i = 0; i < lines.Length; i++)
        {
            string path = lines[i].Trim();
            if (path.Length > 0 && File.Exists(path))
            {
                files.Add(path);
            }
        }
        if (files.Count == 0) return 3;
        Clipboard.SetFileDropList(files);
        return 0;
    }
}
