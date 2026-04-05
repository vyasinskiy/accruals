import crypto from 'node:crypto';
import { config } from '../../config';

class S3StorageService {
  isEnabled(): boolean {
    return Boolean(
      config.S3_ENABLED &&
      config.S3_BUCKET &&
      config.S3_REGION &&
      config.S3_ACCESS_KEY_ID &&
      config.S3_SECRET_ACCESS_KEY
    );
  }

  buildInvoiceKey(accountId: string, periodId: string): string {
    const filename = `${slug(accountId)}-${slug(periodId)}.pdf`;
    const prefix = config.S3_PREFIX.trim().replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${filename}` : filename;
  }

  invoicePrefix(): string {
    return config.S3_PREFIX.trim().replace(/^\/+|\/+$/g, '');
  }

  async listKeys(prefix = this.invoicePrefix()): Promise<Set<string>> {
    if (!this.isEnabled()) return new Set();

    const keys = new Set<string>();
    let continuationToken: string | undefined;

    do {
      const params = new URLSearchParams({ 'list-type': '2' });
      if (prefix) params.set('prefix', prefix);
      if (continuationToken) params.set('continuation-token', continuationToken);

      const signed = this.signBucketRequest(params);
      const response = await fetch(signed.url, { method: 'GET', headers: signed.headers });
      if (!response.ok) {
        throw new Error(`S3 LIST failed with ${response.status}`);
      }

      const xml = await response.text();
      for (const key of extractS3Keys(xml)) keys.add(key);
      continuationToken = extractTag(xml, 'NextContinuationToken') ?? undefined;
    } while (continuationToken);

    return keys;
  }

  async objectExists(key: string): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const signed = this.signRequest('HEAD', key, EMPTY_SHA256);
    const response = await fetch(signed.url, { method: 'HEAD', headers: signed.headers });
    if (response.status === 404) return false;
    if (response.ok) return true;
    throw new Error(`S3 HEAD failed with ${response.status}`);
  }

  async uploadPdf(key: string, body: Buffer): Promise<void> {
    if (!this.isEnabled()) {
      throw new Error('S3 storage is not configured');
    }

    const signed = this.signRequest('PUT', key, sha256Hex(body), 'application/pdf');
    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body: new Uint8Array(body)
    });

    if (!response.ok) {
      throw new Error(`S3 PUT failed with ${response.status}`);
    }
  }

  getSignedDownloadUrl(key: string, ttlSeconds = config.S3_SIGNED_URL_TTL): string {
    if (!this.isEnabled()) {
      throw new Error('S3 storage is not configured');
    }

    const now = new Date();
    const amzDate = formatAmzDate(now);
    const shortDate = amzDate.slice(0, 8);
    const host = this.host();
    const canonicalUri = canonicalUriForKey(key);
    const credentialScope = `${shortDate}/${config.S3_REGION}/s3/aws4_request`;
    const query = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${config.S3_ACCESS_KEY_ID}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(ttlSeconds),
      'X-Amz-SignedHeaders': 'host'
    });

    const canonicalRequest = [
      'GET',
      canonicalUri,
      canonicalizeQuery(query),
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD'
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join('\n');

    query.set('X-Amz-Signature', hmacHex(this.signingKey(shortDate), stringToSign));
    return `https://${host}${canonicalUri}?${canonicalizeQuery(query)}`;
  }

  private signRequest(method: 'HEAD' | 'PUT', key: string, payloadHash: string, contentType?: string) {
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const shortDate = amzDate.slice(0, 8);
    const host = this.host();
    const canonicalUri = canonicalUriForKey(key);
    const credentialScope = `${shortDate}/${config.S3_REGION}/s3/aws4_request`;
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    };

    if (contentType) headers['content-type'] = contentType;

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
    const canonicalRequest = [
      method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaderNames.join(';'),
      payloadHash
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join('\n');

    headers.authorization = [
      `AWS4-HMAC-SHA256 Credential=${config.S3_ACCESS_KEY_ID}/${credentialScope}`,
      `SignedHeaders=${signedHeaderNames.join(';')}`,
      `Signature=${hmacHex(this.signingKey(shortDate), stringToSign)}`
    ].join(', ');

    return {
      url: `https://${host}${canonicalUri}`,
      headers
    };
  }

  private signBucketRequest(query: URLSearchParams) {
    const now = new Date();
    const amzDate = formatAmzDate(now);
    const shortDate = amzDate.slice(0, 8);
    const host = this.host();
    const credentialScope = `${shortDate}/${config.S3_REGION}/s3/aws4_request`;
    const headers: Record<string, string> = {
      host,
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': amzDate
    };
    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join('');
    const canonicalQuery = canonicalizeQuery(query);
    const canonicalRequest = [
      'GET',
      '/',
      canonicalQuery,
      canonicalHeaders,
      signedHeaderNames.join(';'),
      EMPTY_SHA256
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join('\n');

    headers.authorization = [
      `AWS4-HMAC-SHA256 Credential=${config.S3_ACCESS_KEY_ID}/${credentialScope}`,
      `SignedHeaders=${signedHeaderNames.join(';')}`,
      `Signature=${hmacHex(this.signingKey(shortDate), stringToSign)}`
    ].join(', ');

    return {
      url: `https://${host}/?${canonicalQuery}`,
      headers
    };
  }

  private signingKey(shortDate: string): Buffer {
    const kDate = hmac(`AWS4${config.S3_SECRET_ACCESS_KEY}`, shortDate);
    const kRegion = hmac(kDate, config.S3_REGION);
    const kService = hmac(kRegion, 's3');
    return hmac(kService, 'aws4_request');
  }

  private host(): string {
    return `${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com`;
  }
}

const EMPTY_SHA256 = sha256Hex('');

function canonicalUriForKey(key: string): string {
  return `/${key.split('/').map(encodeRfc3986).join('/')}`;
}

function canonicalizeQuery(query: URLSearchParams): string {
  return [...query.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function sha256Hex(value: string | Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key: string | Buffer, value: string): Buffer {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string): string {
  return crypto.createHmac('sha256', key).update(value).digest('hex');
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function extractTag(xml: string, tagName: string): string | null {
  const match = xml.match(new RegExp(`<${tagName}>([^<]*)</${tagName}>`));
  return match ? decodeXml(match[1]) : null;
}

function extractS3Keys(xml: string): string[] {
  return [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => decodeXml(match[1]));
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export const s3Storage = new S3StorageService();
