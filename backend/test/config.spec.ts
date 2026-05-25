import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';

describe('Config loading', () => {
  const originalEnv = process.env.APP_PORT;

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.APP_PORT;
    } else {
      process.env.APP_PORT = originalEnv;
    }
  });

  it('should load APP_PORT from environment variables', async () => {
    process.env.APP_PORT = '4010';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const configService = moduleRef.get(ConfigService);

    expect(configService.get<string>('APP_PORT')).toBe('4010');

    await moduleRef.close();
  });
});
