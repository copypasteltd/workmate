using System;using System.IO;using System.Threading;
class Fixture { static int Main(string[] args) {
 string root=AppDomain.CurrentDomain.BaseDirectory;
 if(args.Length==1&&args[0]=="--hold"){File.WriteAllText(Path.Combine(root,"holding.txt"),"owned");Thread.Sleep(60000);return 0;}
 if(args.Length!=1||args[0]!="--prepare-uninstall")return 99;
 File.AppendAllText(Path.Combine(root,"prepared.txt"),"prepare\n");
 return Int32.Parse(File.ReadAllText(Path.Combine(root,"prepare-exit.txt")));
}}