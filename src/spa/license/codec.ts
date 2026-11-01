import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import {
  LICENSE_PRODUCT,
  TRUSTED_PUBLIC_KEYS,
} from "./config";

ed.hashes.sha512 = sha512;

export const licensePayloadSchema = z.object({
  v: z.number().optional(),
  prod: z.string().optional(),
  product: z.string().optional(),
  mid: z.string().min(1),
  sn: z.string().min(1),
  nbf: z.number().finite().optional(),
  exp: z.number().finite().optional(),
  features: z.array(z.string()).optional(),
});

export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export type LicenseStatus =
  | "active"
  | "pending"
  | "expired"
  | "invalid";

export interface DecodedLicense {
  payload: LicensePayload;
  status: LicenseStatus;
  message: string;
}

export type CheckinStatus =
  | "active"
  | "trial"
  | "pending"
  | "expired"
  | "revoked"
  | "none"
  | "invalid";

export const checkinPayloadSchema = z.object({
  v: z.number().optional(),
  product: z.string().min(1),
  mid: z.string().min(1),
  status: z.enum([
    "active",
    "trial",
    "pending",
    "expired",
    "revoked",
    "none",
    "invalid",
  ]),
  nbf: z.number().finite().nullable().optional(),
  exp: z.number().finite().nullable().optional(),
  licenseId: z.string().nullable().optional(),
  sn: z.string().nullable().optional(),
  trialTotalDays: z.number().nullable().optional(),
  trialLeftDays: z.number().nullable().optional(),
  trialTotalHours: z.number().nullable().optional(),
  trialLeftHours: z.number().nullable().optional(),
  serverTime: z.number().finite().optional(),
  graceUntil: z.number().finite().optional(),
  message: z.string().optional(),
});

export type CheckinPayload = z.infer<typeof checkinPayloadSchema>;

export function normalizeMid(value: string): string {
  return String(value || "")
    .replace(/[-\s]/g, "")
    .toUpperCase();
}

export function formatCode(value: string): string {
  return normalizeMid(value).replace(/(.{4})(?=.)/g, "$1-");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function spkiToRaw(der: Uint8Array): Uint8Array {
  if (der.length === 32) return der;
  if (der.length === 44 && der[0] === 0x30 && der[1] === 0x2a) {
    return der.slice(12);
  }
  throw new Error("授权公钥格式不正确");
}

function trustedKeys(): Uint8Array[] {
  return TRUSTED_PUBLIC_KEYS.map((key) => spkiToRaw(decodeBase64Url(key)));
}

function verifySignature(message: Uint8Array, signature: Uint8Array): boolean {
  for (const key of trustedKeys()) {
    try {
      if (ed.verify(signature, message, key)) return true;
    } catch {
      // 尝试下一把公钥
    }
  }
  return false;
}

function productOf(payload: LicensePayload): string {
  return payload.prod ?? payload.product ?? "";
}

function statusOf(payload: LicensePayload, now = Date.now()): {
  status: LicenseStatus;
  message: string;
} {
  if (typeof payload.nbf === "number" && now < payload.nbf) {
    return { status: "pending", message: "授权尚未生效" };
  }
  if (typeof payload.exp === "number" && payload.exp <= now) {
    return { status: "expired", message: "授权已过期" };
  }
  return { status: "active", message: "授权有效" };
}

export function decodeLicenseCode(
  code: string,
  deviceCode: string,
  now = Date.now(),
): DecodedLicense {
  const trimmed = String(code || "").trim();
  if (!trimmed) throw new Error("请输入激活码");
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) throw new Error("激活码格式不正确");

  const payloadPart = trimmed.slice(0, dot);
  const signaturePart = trimmed.slice(dot + 1);
  const message = new TextEncoder().encode(payloadPart);
  const signature = decodeBase64Url(signaturePart);

  if (!verifySignature(message, signature)) {
    throw new Error("激活码签名无效");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart)));
  } catch {
    throw new Error("激活码内容损坏");
  }

  const result = licensePayloadSchema.safeParse(parsed);
  if (!result.success) throw new Error("激活码内容不完整");
  const payload = result.data;

  if (productOf(payload) !== LICENSE_PRODUCT) {
    throw new Error("该激活码不属于当前产品");
  }
  if (normalizeMid(payload.mid) !== normalizeMid(deviceCode)) {
    throw new Error("激活码与本机不匹配");
  }

  const { status, message: statusMessage } = statusOf(payload, now);
  return { payload, status, message: statusMessage };
}

export function decodeCheckinEnvelope(
  payloadPart: string,
  signaturePart: string,
  deviceCode: string,
): CheckinPayload {
  const message = new TextEncoder().encode(payloadPart);
  if (!verifySignature(message, decodeBase64Url(signaturePart))) {
    throw new Error("授权响应签名无效");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadPart)));
  } catch {
    throw new Error("授权响应内容损坏");
  }

  const result = checkinPayloadSchema.safeParse(parsed);
  if (!result.success) throw new Error("授权响应内容不完整");
  const payload = result.data;
  if (payload.product !== LICENSE_PRODUCT) {
    throw new Error("授权响应产品不匹配");
  }
  if (normalizeMid(payload.mid) !== normalizeMid(deviceCode)) {
    throw new Error("授权响应与本机不匹配");
  }
  return payload;
}
