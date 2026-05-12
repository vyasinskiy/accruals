import { S3StorageService } from './s3-storage.service';
import { config } from '../../common/config/config';

describe('S3StorageService', () => {
  let service: S3StorageService;

  beforeEach(() => {
    service = new S3StorageService();
    // Enable S3 for testing URL generation
    jest.spyOn(service, 'isEnabled').mockReturnValue(true);
  });

  it('should build correct invoice key', () => {
    const key = service.buildInvoiceKey('acc 1', '2026-05');
    const prefix = config.S3_PREFIX.trim().replace(/^\/+|\/+$/g, '');
    const expected = prefix ? `${prefix}/acc-1-2026-05.pdf` : 'acc-1-2026-05.pdf';
    expect(key).toBe(expected);
  });

  it('should generate signed download URL', () => {
    const url = service.getSignedDownloadUrl('test.pdf');
    expect(url).toContain(`https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com/test.pdf`);
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Signature=');
  });

  it('should generate signed upload URL', () => {
    const url = service.getSignedUploadUrl('upload.pdf');
    expect(url).toContain('upload.pdf');
    expect(url).toContain('X-Amz-Expires=600');
  });
});
