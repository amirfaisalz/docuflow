import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface WebhookUrlOptions {
  /**
   * Resolve hostnames and reject any address in a private, loopback, link-local,
   * multicast, or reserved range. Enable before delivering a webhook in production.
   */
  resolveDns?: boolean;
}

const blockedHostnames = new Set(["localhost", "localhost.localdomain"]);
const blockedSuffixes = [".localhost", ".local", ".internal", ".home.arpa"];

function ipv4Octets(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const octets = address.split(".").map(Number);
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : null;
}

function isBlockedIpv4(octets: number[]): boolean {
  const [a, b, c] = octets;
  return (
    a === 0 || // 0.0.0.0/8 "this network"
    a === 10 || // 10.0.0.0/8
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 carrier-grade NAT
    a === 127 || // 127.0.0.0/8 loopback
    (a === 169 && b === 254) || // 169.254.0.0/16 link-local
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0.0/24 and 192.0.2.0/24
    (a === 192 && b === 88 && c === 99) || // 192.88.99.0/24 6to4 relay anycast
    (a === 192 && b === 168) || // 192.168.0.0/16
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmarking
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24 documentation
    (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24 documentation
    a >= 224 // multicast, reserved, and broadcast
  );
}

/**
 * Parses an IPv6 address into 16 bytes. Handles `::` compression and embedded
 * dotted-quad IPv4 tails so expanded forms such as `0:0:0:0:0:0:0:1` cannot
 * slip past the compressed-form checks below.
 */
function parseIpv6(address: string): number[] | null {
  if (isIP(address) !== 6) return null;
  const zoneIndex = address.indexOf("%");
  let value = (zoneIndex === -1 ? address : address.slice(0, zoneIndex)).toLowerCase();

  const lastColon = value.lastIndexOf(":");
  if (lastColon !== -1) {
    const maybeIpv4 = value.slice(lastColon + 1);
    if (maybeIpv4.includes(".")) {
      const octets = ipv4Octets(maybeIpv4);
      if (!octets) return null;
      const high = ((octets[0] << 8) | octets[1]).toString(16);
      const low = ((octets[2] << 8) | octets[3]).toString(16);
      value = `${value.slice(0, lastColon)}:${high}:${low}`;
    }
  }

  const compressed = value.includes("::");
  let head: string[];
  let tail: string[];
  if (compressed) {
    const [headPart = "", tailPart = ""] = value.split("::");
    head = headPart ? headPart.split(":") : [];
    tail = tailPart ? tailPart.split(":") : [];
  } else {
    head = value.split(":");
    tail = [];
  }
  const missing = 8 - head.length - tail.length;
  if (compressed ? missing < 1 : missing !== 0) return null;

  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

function isBlockedIpv6(bytes: number[]): boolean {
  const leading = bytes.slice(0, 10).every((byte) => byte === 0);
  const ipv4Tail = bytes.slice(12);

  if (leading && bytes[10] === 0 && bytes[11] === 0) {
    // ::/96 covers the unspecified address, loopback, and deprecated
    // IPv4-compatible addresses.
    if (ipv4Tail.every((byte) => byte === 0)) return true; // ::
    if (ipv4Tail[0] === 0 && ipv4Tail[1] === 0 && ipv4Tail[2] === 0 && ipv4Tail[3] === 1) return true; // ::1
    return isBlockedIpv4(ipv4Tail);
  }
  // ::ffff:0:0/96 IPv4-mapped addresses.
  if (leading && bytes[10] === 0xff && bytes[11] === 0xff) return isBlockedIpv4(ipv4Tail);
  // 64:ff9b::/96 NAT64.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && bytes.slice(4, 12).every((byte) => byte === 0)) return isBlockedIpv4(ipv4Tail);
  // 2002::/16 6to4 embeds an IPv4 address in the next 32 bits.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return isBlockedIpv4(bytes.slice(2, 6));
  // 2001:0::/32 Teredo and 2001:db8::/32 documentation.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  // 100::/64 discard-only.
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && bytes.slice(2, 8).every((byte) => byte === 0)) return true;
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe) return true; // fe80::/10 link-local and fec0::/10 site-local
  if (bytes[0] === 0xff) return true; // ff00::/8 multicast
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = ipv4Octets(address);
    return octets ? isBlockedIpv4(octets) : true;
  }
  if (version === 6) {
    const bytes = parseIpv6(address);
    return bytes ? isBlockedIpv6(bytes) : true;
  }
  return true;
}

/**
 * Returns true only for HTTPS URLs whose host cannot reach a private network.
 * Literal IP addresses are always checked. Hostnames are optionally resolved so
 * a public-looking domain cannot point at an internal service.
 */
export async function isSafeWebhookUrl(value: string, options: WebhookUrlOptions = {}): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!hostname) return false;
  if (blockedHostnames.has(hostname) || blockedSuffixes.some((suffix) => hostname.endsWith(suffix))) return false;

  const version = isIP(hostname);
  if (version !== 0) return !isBlockedAddress(hostname);
  if (!options.resolveDns) return true;

  try {
    const records = await lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every(({ address }) => !isBlockedAddress(address));
  } catch {
    return false;
  }
}
