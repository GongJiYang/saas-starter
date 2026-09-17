import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [first, second] = octets;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && (second === 0 || second === 168))
    || first >= 224;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
      return isPrivateIpv4(normalized.slice('::ffff:'.length));
    }
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe8')
      || normalized.startsWith('fe9')
      || normalized.startsWith('fea')
      || normalized.startsWith('feb');
  }
  return true;
}

export async function assertSafeRemoteUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL is invalid.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Remote asset URLs must use HTTPS.');
  }
  if (url.username || url.password) {
    throw new Error('Remote asset URLs cannot contain credentials.');
  }
  if (url.port && url.port !== '443') {
    throw new Error('Remote asset URLs may only use the HTTPS port.');
  }

  const addresses = isIP(url.hostname)
    ? [url.hostname]
    : (await lookup(url.hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  if (addresses.some(isPrivateAddress)) {
    throw new Error('Remote asset URL resolves to a private or reserved address.');
  }

  return url;
}
