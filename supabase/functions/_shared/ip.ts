// IP normalisation shared by audit writers. Only well-formed addresses reach `inet` columns; anything else is NULL.
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:.]{2,45}$/;

/** Well-formed IPv4/IPv6 text or null (never throws, never fails the request). */
export function normalizeIp(raw: string): string | null {
  const ip = raw.trim();
  if (IPV4.test(ip)) return ip;
  if (ip.includes(":") && ip.split(":").length >= 3 && IPV6.test(ip)) return ip;
  return null;
}
