import { randomUUID } from 'crypto';
import * as compression from 'compression';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import * as hpp from 'hpp';
import { setupGracefulShutdown } from 'nestjs-graceful-shutdown';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/error/http-exception-filter';
import { I18nValidationPipe } from './common/validate/i18n-validation.pipe';
import { I18nService } from './i18n/i18n.service';
import { SwaggerService } from './swagger/swagger.service';

const SENSITIVE_KEY_PATTERNS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'token',
  'access_token',
  'refresh_token',
  'password',
  'pass',
  'secret',
  'session',
  'jwt',
];

const CORRELATION_ID_HEADER = 'x-correlation-id';
const CORRELATION_ID_COOKIE = 'correlation-id';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isSensitiveKey = (key: string) =>
  SENSITIVE_KEY_PATTERNS.some((pattern) => key.toLowerCase().includes(pattern));

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (acc, [key, entry]) => {
        acc[key] = isSensitiveKey(key) ? '[REDACTED]' : redactValue(entry);
        return acc;
      },
      {},
    );
  }
  return value;
};

const normalizeBody = (body: unknown, contentType?: string): unknown => {
  if (body === undefined) return undefined;
  if (Buffer.isBuffer(body)) return body.toString('utf8');
  if (typeof body === 'string') {
    if (contentType?.includes('application/json')) {
      try {
        return redactValue(JSON.parse(body));
      } catch {
        return body;
      }
    }
    return body;
  }
  return redactValue(body);
};

const normalizeHeaders = (headers: Record<string, unknown>) => {
  const cleaned = Object.entries(headers).reduce<Record<string, unknown>>(
    (acc, [key, value]) => {
      if (value !== undefined) acc[key] = value;
      return acc;
    },
    {},
  );
  return redactValue(cleaned);
};

const safeStringify = (value: unknown) => {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[CIRCULAR]';
      seen.add(val);
    }
    return val;
  });
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.use(cookieParser());

  app.use((req, res, next) => {
    const headerValue = req.headers[CORRELATION_ID_HEADER];
    const cookieValue = req.cookies?.[CORRELATION_ID_COOKIE];
    const correlationId =
      typeof headerValue === 'string' && headerValue.length > 0
        ? headerValue
        : typeof cookieValue === 'string' && cookieValue.length > 0
          ? cookieValue
          : randomUUID();

    (req.headers as Record<string, string>)[CORRELATION_ID_HEADER] =
      correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    res.cookie(CORRELATION_ID_COOKIE, correlationId);

    const startedAt = process.hrtime.bigint();
    const requestHeaders = normalizeHeaders(
      req.headers as Record<string, unknown>,
    );
    const requestBody = normalizeBody(req.body, req.headers['content-type']);
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    let responseBody: unknown;

    res.send = (body: unknown) => {
      responseBody = body;
      return originalSend(body);
    };
    res.json = (body: unknown) => {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const responseHeaders = normalizeHeaders(
        res.getHeaders() as Record<string, unknown>,
      );
      const responseBodyNormalized = normalizeBody(
        responseBody,
        res.getHeader('content-type')?.toString(),
      );
      Logger.log(
        safeStringify({
          service: 'auth-api',
          correlationId,
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          durationMs: Number(durationMs.toFixed(1)),
          request: {
            headers: requestHeaders,
            body: requestBody,
          },
          response: {
            headers: responseHeaders,
            body: responseBodyNormalized,
          },
        }),
      );
    });

    next();
  });

  setupGracefulShutdown({ app });

  app.setGlobalPrefix(
    configService.get<string>('API_GLOBAL_PREFIX', { infer: true }) ||
      'default-prefix',
  );

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(hpp());
  app.use(compression());

  const i18nService = app.get(I18nService);

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new I18nValidationPipe(i18nService));

  const swaggerService = app.get(SwaggerService);
  swaggerService.setupSwagger(app);

  app.enableCors({
    origin: [
      configService.get<string>('CORS_ORIGIN', { infer: true }),
      configService.get<string>('CORS_ORIGIN_LOCAL', { infer: true }),
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const PORT = configService.get<number>('API_PORT', { infer: true }) || 3001;

  await app.listen(PORT, '0.0.0.0');

  Logger.log(`🚀 Application is running on: http://localhost:${PORT}/`);
  Logger.log(`📚 Swagger docs available at: http://localhost:${PORT}/api/docs`);
}
void bootstrap();
