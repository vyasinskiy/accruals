import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { config } from '../../common/config/config';

@Injectable()
export class S3StorageService {
  isEnabled(): boolean {
    return Boolean(
      config.S3_ENABLED &&
      config.S3_BUCKET &&
      config.S3_REGION &&
      config.S3_ACCESS_KEY_ID &&
      config.S3_SECRET_ACCESS_KEY
    );
  }

  isUploaded(uploadedToS3: boolean): boolean {
    return !this.isEnabled() || uploadedToS3;
  }

  buildInvoiceKey(accountId: string, periodId: string): string {
    const filename = `${slug(accountId)}-${slug(periodId)}.pdf`;
    const prefix = config.S3_PREFIX.trim().replace(/^\/+|\/+$/g, '');
    return prefix ? `${prefix}/${filename}` : filename;
  }

  getSignedDownloadUrl(key: string, ttlSeconds = config.S3_SIGNED_URL_TTL): string {
    return this.getSignedUrl('GET', key, ttlSeconds);
  }

  getSignedUploadUrl(key: string, ttlSeconds = 600): string {
    return this.getSignedUrl('PUT', key, ttlSeconds, 'application/pdf');
  }

  private getSignedUrl(method: 'GET' | 'PUT', key: string, ttlSeconds: number, contentType?: string): string {
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

    if (contentType && method === 'PUT') {
        // For PUT uploads, we don't always put content-type in query, 
        // but it must be in the signed headers if the client sends it.
        // Simplified version: just sign the host.
    }

    const canonicalRequest = [
      method,
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
