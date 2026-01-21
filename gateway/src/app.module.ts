import { Request, Response } from 'express';
import { GraphQLFormattedError } from 'graphql';
import {
  IntrospectAndCompose,
  RemoteGraphQLDataSource,
  GraphQLDataSourceProcessOptions,
} from '@apollo/gateway';
import { ApolloGatewayDriver, ApolloGatewayDriverConfig } from '@nestjs/apollo';
import {
  ApolloServerPlugin,
  GraphQLRequestContextWillSendResponse,
} from '@apollo/server';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';

import { AppController } from './app.controller';
import { AppService } from './app.service';

enum ErrorCode {
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

const errorCodeToStatus: Record<string, number> = {
  [ErrorCode.UNAUTHENTICATED]: 401,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.VALIDATION_ERROR]: 400,
  [ErrorCode.BAD_REQUEST]: 400,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CONFLICT]: 409,
  [ErrorCode.INTERNAL_SERVER_ERROR]: 500,
  [ErrorCode.SERVICE_UNAVAILABLE]: 503,
};

function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

interface ErrorExtensions {
  code?: string;
  statusCode?: number;
  timestamp?: string;
  field?: string;
  details?: Record<string, unknown>;
}

class AuthenticatedDataSource extends RemoteGraphQLDataSource {
  override willSendRequest(options: GraphQLDataSourceProcessOptions): void {
    const { request, context } = options;
    if (!request.http) return;

    const ctx = context as { req?: Request };

    const authorization = ctx.req?.headers?.authorization;
    if (authorization && typeof authorization === 'string') {
      request.http.headers.set('authorization', authorization);
    }

    const acceptLanguage = ctx.req?.headers?.['accept-language'];
    if (acceptLanguage && typeof acceptLanguage === 'string') {
      request.http.headers.set('accept-language', acceptLanguage);
    }

    const userAgent = ctx.req?.headers?.['user-agent'];
    if (userAgent && typeof userAgent === 'string') {
      request.http.headers.set('user-agent', userAgent);
    }

    const correlationIdHeader = ctx.req?.headers?.['x-correlation-id'];
    const correlationId =
      typeof correlationIdHeader === 'string'
        ? correlationIdHeader
        : generateCorrelationId();
    request.http.headers.set('x-correlation-id', correlationId);
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    GraphQLModule.forRootAsync<ApolloGatewayDriverConfig>({
      driver: ApolloGatewayDriver,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        server: {
          context: ({ req, res }: { req: Request; res: Response }) => ({
            req,
            res,
            correlationId: req.headers['x-correlation-id'],
          }),
          formatError: (
            formattedError: GraphQLFormattedError,
          ): GraphQLFormattedError => {
            const extensions = (formattedError.extensions ||
              {}) as ErrorExtensions;
            const code = extensions.code || ErrorCode.INTERNAL_SERVER_ERROR;
            const statusCode =
              extensions.statusCode || errorCodeToStatus[code] || 500;

            const isDev = configService.get('NODE_ENV') !== 'production';

            return {
              message: formattedError.message,
              path: formattedError.path,
              extensions: {
                code,
                statusCode,
                timestamp: extensions.timestamp || new Date().toISOString(),
                ...(extensions.field && { field: extensions.field }),
                ...(extensions.details &&
                  isDev && { details: extensions.details }),
              },
            };
          },
          plugins: [
            {
              requestDidStart: async () => ({
                willSendResponse: async (
                  requestContext: GraphQLRequestContextWillSendResponse<{
                    correlationId?: string;
                  }>,
                ) => {
                  const correlationId =
                    requestContext.contextValue?.correlationId;
                  if (!correlationId) return;

                  const body = (requestContext.response as any).body;
                  if (!body || body.kind !== 'single') return;

                  const result = body.singleResult;
                  result.extensions = {
                    ...(result.extensions || {}),
                    correlationId,
                  };
                  if (result.errors) {
                    result.errors = result.errors.map((err: any) => ({
                      ...err,
                      extensions: {
                        ...(err.extensions || {}),
                        correlationId,
                      },
                    }));
                  }
                },
              }),
            } as ApolloServerPlugin,
          ],
        },
        gateway: {
          supergraphSdl: new IntrospectAndCompose({
            subgraphs: [
              {
                name: 'auth',
                url: configService.get(
                  'AUTH_GRAPHQL_URL',
                  'http://localhost:3001/api/graphql',
                ),
              },
              {
                name: 'product',
                url: configService.get(
                  'PRODUCT_GRAPHQL_URL',
                  'http://localhost:3002/api/graphql',
                ),
              },
            ],
            pollIntervalInMs: configService.get('GRAPHQL_POLL_INTERVAL', 10000),
            introspectionHeaders: {
              'Content-Type': 'application/json',
            },
          }),
          buildService({ url }) {
            return new AuthenticatedDataSource({ url });
          },
        },
      }),
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
