import { S3StorageService } from './s3-storage.service';
import { config } from '../../config';

describe('S3StorageService', () => {
  let service: S3StorageService;

  beforeEach(() => {
    service = new S3StorageService();
    // Ensure S3 is enabled for tests if we want to test URL generation
    jest.spyOn(service, 'isEnabled').mockReturnValue(true);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSignedDownloadUrl', () => {
    it('should generate a valid-looking AWS S3 signed URL', () => {
      const key = 'invoices/123/2026-05.pdf';
      const url = service.getSignedDownloadUrl(key);

      expect(url).toContain(`https://${config.S3_BUCKET}.s3.${config.S3_REGION}.amazonaws.com/invoices/123/2026-05.pdf`);
      expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
      expect(url).toContain('X-Amz-Signature=');
      expect(url).toContain('X-Amz-SignedHeaders=host');
    });

    it('should return empty string if S3 is disabled', () => {
      jest.spyOn(service, 'isEnabled').mockReturnValue(false);
      const url = service.getSignedDownloadUrl('any-key');
      expect(url).toBe('');
    });
  });
});
