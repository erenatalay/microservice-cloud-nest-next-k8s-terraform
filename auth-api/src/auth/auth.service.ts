import {
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { I18nService } from '../i18n/i18n.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from '../token/token.service';
import { HashingService } from '../utils/hashing/hashing.module';
import { AuthProviderEnum } from './auth.types';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { AuthLoginRequestDto } from './dto/login-request-auth.dto';
import { AuthLoginResponseDto } from './dto/login.response-auth.dto';
import { AuthRegisterRequestDto } from './dto/register-request-auth.dto';
import { AuthRegisterResponseDto } from './dto/register.response-auth.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyAccountDto } from './dto/verify-account.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly hashingService: HashingService,
    private readonly i18nService: I18nService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly tokenService: TokenService,
  ) {}

  private generateActivationCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private generateRandomCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async registerUserService(
    registerUserDto: AuthRegisterRequestDto,
  ): Promise<AuthRegisterResponseDto> {
    const { firstname, lastname, email, password } = registerUserDto;

    const existingActiveUser = await this.prismaService.users.findFirst({
      where: {
        email,
        deletedAt: null,
      },
    });

    if (existingActiveUser) {
      throw new UnprocessableEntityException({
        message: this.i18nService.translate('error.user.aldready.exist'),
      });
    }

    const softDeletedUser = await this.prismaService.users.findFirst({
      where: {
        email,
        NOT: { deletedAt: null },
      },
    });

    const hashedPassword = await this.hashingService.hashPassword(password);

    let user;

    if (softDeletedUser) {
      user = await this.prismaService.users.update({
        where: { id: softDeletedUser.id },
        data: {
          firstname,
          lastname,
          password: hashedPassword,
          socialProvider: AuthProviderEnum.DEFAULT,
          deletedAt: null,
          isActive: true,
          activationCode: null,
        },
      });
    } else {
      user = await this.prismaService.users.create({
        data: {
          firstname,
          lastname,
          email,
          password: hashedPassword,
          socialProvider: AuthProviderEnum.DEFAULT,
          isActive: true,
          activationCode: null,
        },
      });
    }

    const accessToken = await this.tokenService.createAccessToken(user);
    const refreshToken = await this.tokenService.createRefreshToken(user);

    return {
      id: user.id,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      birthday: user.birthday || undefined,
      phone: user.phone || '',
      avatar: user.avatar || '',
      accessToken,
      refreshToken,
    };
  }

  async verifyAccount(verifyAccountDto: VerifyAccountDto): Promise<void> {
    const { email, activationCode } = verifyAccountDto;

    const user = await this.prismaService.users.findFirst({
      where: {
        email,
        activationCode,
      },
    });

    if (!user) {
      throw new BadRequestException({
        message: this.i18nService.translate('error.invalid.activation.code'),
      });
    }

    await this.prismaService.users.update({
      where: { id: user.id },
      data: {
        isActive: true,
        activationCode: null,
      },
    });
  }

  async loginUserService(
    loginUserDto: AuthLoginRequestDto,
  ): Promise<AuthLoginResponseDto> {
    const { email, password } = loginUserDto;

    const user = await this.prismaService.users.findFirst({
      where: {
        email,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!user) {
      const deletedUser = await this.prismaService.users.findFirst({
        where: {
          email,
          NOT: { deletedAt: null },
        },
      });

      if (deletedUser) {
        throw new UnauthorizedException({
          message: this.i18nService.translate('error.user.account.deleted'),
        });
      }

      const inactiveUser = await this.prismaService.users.findFirst({
        where: {
          email,
          isActive: false,
          deletedAt: null,
        },
      });

      if (inactiveUser) {
        throw new UnauthorizedException({
          message: this.i18nService.translate(
            'error.user.account.not.activated',
          ),
        });
      }

      throw new UnauthorizedException({
        message: this.i18nService.translate('error.userNotFound.email'),
      });
    }

    const isPasswordValid = await this.hashingService.comparePassword(
      password,
      user.password,
    );

    if (!isPasswordValid)
      throw new UnauthorizedException({
        message: this.i18nService.translate(
          'error.userNotFound.invalid.password',
        ),
      });

    const accessToken = await this.tokenService.createAccessToken(user);
    const refreshToken = await this.tokenService.createRefreshToken(user);

    return {
      id: user.id,
      email: user.email,
      firstname: user.firstname,
      lastname: user.lastname,
      birthday: user.birthday || undefined,
      phone: user.phone || '',
      avatar: user.avatar || '',
      accessToken,
      refreshToken,
    };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto): Promise<void> {
    const { email } = forgotPasswordDto;

    const user = await this.prismaService.users.findFirst({
      where: {
        email,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!user) {
      throw new NotFoundException({
        message: this.i18nService.translate('error.userNotFound.email'),
      });
    }

    const resetCode = this.generateRandomCode();

    const expiresInMinutes = parseInt(
      this.configService
        .get<string>('PASSWORD_RESET_EXPIRES_IN', '15m')
        .replace('m', ''),
      10,
    );
    const resetExpire = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    await this.prismaService.users.update({
      where: { id: user.id },
      data: {
        resetCode,
        resetExpire,
      },
    });

    await this.mailService.forgotPassword({
      to: email,
      data: {
        hash: resetCode,
        tokenExpires: resetExpire.getTime(),
      },
    });
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<void> {
    const { email, resetCode, newPassword } = resetPasswordDto;

    const user = await this.prismaService.users.findFirst({
      where: {
        email,
        resetCode,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!user) {
      throw new BadRequestException({
        message: this.i18nService.translate('error.invalid.reset.code'),
      });
    }

    if (!user.resetExpire || user.resetExpire < new Date()) {
      await this.prismaService.users.update({
        where: { id: user.id },
        data: {
          resetCode: null,
          resetExpire: null,
        },
      });

      throw new UnauthorizedException({
        message: this.i18nService.translate('error.reset.code.expired'),
      });
    }

    const hashedPassword = await this.hashingService.hashPassword(newPassword);

    await this.prismaService.users.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        resetCode: null,
        resetExpire: null,
      },
    });
  }
}
