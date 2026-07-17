import { Test, TestingModule } from '@nestjs/testing';
import { MeterEventService } from './meter-event.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ClientProxy } from '@nestjs/microservices';

describe('MeterEventService', () => {
  let service: MeterEventService;
  let prisma: PrismaService;
  let notificationsClient: ClientProxy;

  const mockPrisma = {
    account: {
      findMany: jest.fn(),
    },
    meterSubmissionEvent: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockNotifications = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeterEventService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'NOTIFICATIONS_SERVICE', useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<MeterEventService>(MeterEventService);
    prisma = module.get<PrismaService>(PrismaService);
    notificationsClient = module.get<ClientProxy>('NOTIFICATIONS_SERVICE');

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitReadings', () => {
    it('should return error if event not found', async () => {
      mockPrisma.meterSubmissionEvent.findUnique.mockResolvedValueOnce(null);
      const res = await service.submitReadings(123);
      expect(res.success).toBe(false);
      expect(res.message).toContain('Событие не найдено');
    });

    it('should return success and alreadySubmitted true if already submitted', async () => {
      mockPrisma.meterSubmissionEvent.findUnique.mockResolvedValueOnce({
        id: 123,
        status: 'SUBMITTED',
      });
      const res = await service.submitReadings(123);
      expect(res.success).toBe(true);
      expect(res.alreadySubmitted).toBe(true);
    });

    it('should mark readings as submitted', async () => {
      mockPrisma.meterSubmissionEvent.findUnique.mockResolvedValueOnce({
        id: 123,
        status: 'PENDING',
      });
      mockPrisma.meterSubmissionEvent.update.mockResolvedValueOnce({
        id: 123,
        status: 'SUBMITTED',
      });

      const res = await service.submitReadings(123);
      expect(res.success).toBe(true);
      expect(res.alreadySubmitted).toBe(false);
      expect(mockPrisma.meterSubmissionEvent.update).toHaveBeenCalled();
    });
  });

  describe('markReceived', () => {
    it('should set status to RECEIVED', async () => {
      mockPrisma.meterSubmissionEvent.findUnique.mockResolvedValueOnce({ id: 123 });
      mockPrisma.meterSubmissionEvent.update.mockResolvedValueOnce({ id: 123, status: 'RECEIVED' });
      const res = await service.markReceived(123);
      expect(res.success).toBe(true);
      expect(mockPrisma.meterSubmissionEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RECEIVED' })
        })
      );
    });
  });

  describe('submitValue', () => {
    it('should save readingsValue in db and set status to RECEIVED', async () => {
      mockPrisma.meterSubmissionEvent.findUnique.mockResolvedValueOnce({ id: 123 });
      mockPrisma.meterSubmissionEvent.update.mockResolvedValueOnce({ id: 123, status: 'RECEIVED', readingsValue: '123.45' });
      const res = await service.submitValue(123, '123.45');
      expect(res.success).toBe(true);
      expect(mockPrisma.meterSubmissionEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'RECEIVED', readingsValue: '123.45' })
        })
      );
    });
  });

  describe('completeWithoutSubmission', () => {
    it('should set status to COMPLETED_WITHOUT_SUBMISSION', async () => {
      mockPrisma.meterSubmissionEvent.findUnique.mockResolvedValueOnce({ id: 123 });
      mockPrisma.meterSubmissionEvent.update.mockResolvedValueOnce({ id: 123, status: 'COMPLETED_WITHOUT_SUBMISSION' });
      const res = await service.completeWithoutSubmission(123);
      expect(res.success).toBe(true);
      expect(mockPrisma.meterSubmissionEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'COMPLETED_WITHOUT_SUBMISSION' })
        })
      );
    });
  });

  describe('ensureEventsExistForCurrentMonth', () => {
    it('should create events for accounts with their custom meterSubmissionDay', async () => {
      mockPrisma.account.findMany.mockResolvedValueOnce([
        { id: 1, externalId: 'acc-1', meterSubmissionDay: 15 },
        { id: 2, externalId: 'acc-2', meterSubmissionDay: 25 },
      ]);
      mockPrisma.meterSubmissionEvent.findUnique.mockResolvedValue(null);

      await service.ensureEventsExistForCurrentMonth();

      expect(mockPrisma.meterSubmissionEvent.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.meterSubmissionEvent.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          data: expect.objectContaining({
            accountId: 1
          })
        })
      );
    });
  });
});
