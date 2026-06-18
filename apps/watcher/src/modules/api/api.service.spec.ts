import { Test, TestingModule } from '@nestjs/testing';
import { ApiService } from './api.service';
import { PrismaService } from '../../common/prisma/prisma.service';

describe('ApiService', () => {
  let service: ApiService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    run: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<ApiService>(ApiService);
    prismaService = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRuns', () => {
    it('should call prisma.run.findMany with correct arguments', async () => {
      const mockRuns = [{ id: 1 }];
      mockPrismaService.run.findMany.mockResolvedValue(mockRuns);
      const result = await service.getRuns();
      expect(result).toEqual(mockRuns);
      expect(mockPrismaService.run.findMany).toHaveBeenCalledWith({
        orderBy: { startedAt: 'desc' },
        take: 20,
      });
    });
  });
});
