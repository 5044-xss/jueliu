import { spawnSync } from "node:child_process";

// Node 内置 fetch 不走系统代理，curl.exe 不读 WinINET 设置，故显式探测代理。
export function detectProxy() {
  const fromEnv =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (fromEnv) return fromEnv;

  const result = spawnSync(
    "reg",
    [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
      "/v",
      "ProxyServer",
    ],
    { encoding: "utf8" },
  );
  const match = /ProxyServer\s+REG_SZ\s+(\S+)/.exec(result.stdout || "");
  if (!match) return null;
  let value = match[1];
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value;
}

export function curlDownload(url, dest) {
  const proxy = detectProxy();
  const args = ["-L", "-f", "--retry", "4", "--retry-delay", "2"];
  if (proxy) args.push("-x", proxy);
  args.push("-o", dest, url);

  const result = spawnSync("curl.exe", args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`下载失败：${url}`);
  }
}
