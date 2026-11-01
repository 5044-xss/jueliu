import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function normalizeMid(value) {
  return String(value || "")
    .replace(/[-\s]/g, "")
    .toUpperCase();
}

function formatCode(value) {
  return normalizeMid(value).replace(/(.{4})(?=.)/g, "$1-");
}

const privateKeyPath = path.resolve(
  root,
  arg("key", "keys/license-private.pem"),
);

if (!fs.existsSync(privateKeyPath)) {
  console.error(`找不到私钥：${privateKeyPath}`);
  console.error("私钥不入库，请把 license-private.pem 放到 keys/ 下。");
  process.exit(1);
}

const privateKey = crypto.createPrivateKey(
  fs.readFileSync(privateKeyPath, "utf8"),
);
const publicKeyDer = crypto
  .createPublicKey(privateKey)
  .export({ type: "spki", format: "der" })
  .toString("base64");

const mid = normalizeMid(arg("mid"));
if (!mid) {
  console.error("缺少 --mid（用户设备码）");
  console.error("示例：npm run license:sign -- --mid A1B2-C3D4-E5F6-7890 --days 365");
  process.exit(1);
}

const product = arg("product", "jueliu").trim() || "jueliu";
const sn = arg("sn", `LIC-${Date.now()}`);
const days = Number(arg("days", "0"));
const expArg = arg("exp", "");
const nbfArg = arg("nbf", "");

let nbf;
if (nbfArg) {
  nbf = /^\d+$/.test(nbfArg) ? Number(nbfArg) : Date.parse(nbfArg);
  if (!Number.isFinite(nbf)) throw new Error("--nbf 不是有效时间");
}

let exp;
if (expArg) {
  exp = /^\d+$/.test(expArg) ? Number(expArg) : Date.parse(expArg);
  if (!Number.isFinite(exp)) throw new Error("--exp 不是有效时间");
} else if (days > 0) {
  exp = Date.now() + days * 24 * 60 * 60 * 1000;
}

const payload = {
  v: 1,
  prod: product,
  mid,
  sn,
  ...(nbf ? { nbf } : {}),
  ...(exp ? { exp } : {}),
  features: arg("features", "local,desktop,mobile")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
};

const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString(
  "base64url",
);
const signature = crypto
  .sign(null, Buffer.from(payloadPart, "utf8"), privateKey)
  .toString("base64url");

console.log("");
console.log("设备码：", formatCode(mid));
console.log("授权编号：", sn);
console.log("产品：", product);
console.log("到期：", exp ? new Date(exp).toLocaleString("zh-CN") : "长期");
console.log("公钥：", publicKeyDer);
console.log("");
console.log("激活码：");
console.log(`${payloadPart}.${signature}`);
console.log("");
