import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { APP_ENVIRONMENT, type AppEnvironment } from '../config/env.js';
import {
  AuthFailure,
  AuthService,
  type CompleteNearAuthInput,
} from './auth.service.js';
import { readCookie } from './session-cookie.js';

const verifySchema = z
  .object({
    challengeId: z.string().uuid(),
    accountId: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
    publicKey: z.string().min(10).max(4096),
    signature: z.string().min(4).max(8192),
    nonce: z.string().min(44).max(44),
    state: z
      .string()
      .min(43)
      .max(43)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

const challengeResponseSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: [
    'challengeId',
    'network',
    'message',
    'recipient',
    'nonce',
    'state',
    'expiresAt',
  ],
  properties: {
    challengeId: { type: 'string', format: 'uuid' },
    network: { type: 'string', enum: ['testnet'] },
    message: { type: 'string' },
    recipient: { type: 'string', format: 'uri' },
    nonce: { type: 'string' },
    state: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};

const sessionResponseSchema: SchemaObject = {
  type: 'object',
  additionalProperties: false,
  required: ['sessionId', 'userId', 'expiresAt', 'wallets', 'memberships'],
  properties: {
    sessionId: { type: 'string' },
    userId: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
    wallets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['network', 'accountId'],
        properties: {
          network: { type: 'string' },
          accountId: { type: 'string' },
        },
      },
    },
    memberships: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['organizationId', 'role'],
        properties: {
          organizationId: { type: 'string' },
          role: { type: 'string' },
        },
      },
    },
  },
};

@ApiTags('authentication')
@Controller('v1/auth')
export class AuthController {
  private readonly secureCookies: boolean;

  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_ENVIRONMENT) environment: AppEnvironment,
  ) {
    this.secureCookies = new URL(environment.WEB_URL).protocol === 'https:';
  }

  @Post('near/challenge')
  @ApiOperation({ summary: 'Create a one-time NEP-413 login challenge' })
  @ApiResponse({
    status: 201,
    description: 'Five-minute signing challenge',
    schema: challengeResponseSchema,
  })
  createNearChallenge() {
    return this.auth.createNearChallenge();
  }

  @Post('near/verify')
  @ApiOperation({ summary: 'Verify NEP-413 proof and create a session' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'challengeId',
        'accountId',
        'publicKey',
        'signature',
        'nonce',
        'state',
      ],
      properties: {
        challengeId: { type: 'string', format: 'uuid' },
        accountId: { type: 'string' },
        publicKey: { type: 'string' },
        signature: { type: 'string' },
        nonce: { type: 'string' },
        state: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Authenticated session created',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['userId', 'expiresAt'],
      properties: {
        userId: { type: 'string' },
        expiresAt: { type: 'string', format: 'date-time' },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or used proof' })
  async verifyNear(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    let input: CompleteNearAuthInput;
    try {
      input = verifySchema.parse(body);
    } catch {
      throw new UnauthorizedException();
    }
    try {
      const result = await this.auth.completeNearAuth(input);
      const cookieOptions = {
        secure: this.secureCookies,
        sameSite: 'strict' as const,
        path: '/',
        maxAge: new Date(result.expiresAt).getTime() - Date.now(),
      };
      response.cookie('coffer_session', result.sessionToken, {
        ...cookieOptions,
        httpOnly: true,
      });
      response.cookie('coffer_csrf', result.csrfToken, {
        ...cookieOptions,
        httpOnly: false,
      });
      return { userId: result.userId, expiresAt: result.expiresAt };
    } catch (error) {
      if (error instanceof AuthFailure) throw new UnauthorizedException();
      throw error;
    }
  }

  @Get('session')
  @ApiCookieAuth('coffer_session')
  @ApiOperation({ summary: 'Read the active session and memberships' })
  @ApiResponse({
    status: 200,
    description: 'Active session principal',
    schema: sessionResponseSchema,
  })
  @ApiResponse({ status: 401, description: 'Missing or inactive session' })
  async session(@Headers('cookie') cookieHeader: string | undefined) {
    const token = readCookie(cookieHeader, 'coffer_session');
    if (!token) throw new UnauthorizedException();
    return this.auth.getSession(token);
  }

  @Post('logout')
  @ApiCookieAuth('coffer_session')
  @ApiOperation({ summary: 'Revoke the active session' })
  @ApiResponse({ status: 201, description: 'Session revoked' })
  @ApiResponse({ status: 401, description: 'Missing session or CSRF proof' })
  async logout(
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('x-csrf-token') csrfToken: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const sessionToken = readCookie(cookieHeader, 'coffer_session');
    const csrfCookie = readCookie(cookieHeader, 'coffer_csrf');
    if (
      !sessionToken ||
      !csrfCookie ||
      !csrfToken ||
      csrfCookie !== csrfToken
    ) {
      throw new UnauthorizedException();
    }
    await this.auth.logout(sessionToken, csrfToken);
    response.clearCookie('coffer_session', { path: '/' });
    response.clearCookie('coffer_csrf', { path: '/' });
    return { status: 'revoked' };
  }
}
