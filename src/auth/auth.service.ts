import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthDto } from './dto';
import * as argon from 'argon2';
import { Tokens } from './interfaces';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';


@Injectable()
export class AuthService {
  constructor(private config: ConfigService, private prisma: PrismaService, private jwtService: JwtService) {}

  async getTokens(userId: number, email: string) {
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync({
        sub: userId,
        email,
      },
        {
          secret: this.config.get('JWT_AT_SECRET'),
          expiresIn: 60 * 15
        }),
      this.jwtService.signAsync({
        sub: userId,
        email,
      },
        {
          secret: this.config.get('JWT_RT_SECRET'),
          expiresIn: 60 * 60 * 24 * 7
        })
    ])
    return {
      access_token,
      refresh_token,
    }
  }

  async updateRtHash(userId: number, rt: string) {
    const rtHash = await argon.hash(rt);

    await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        hashRt: rtHash,
      }
    })
  }

  async signupLocal(dto: AuthDto): Promise<Tokens> {
    const hash = await argon.hash(dto.password)
    const newUser = await this.prisma.user.create({
      data: {
        email: dto.email,
        hash
      }
    })

    const tokens = await this.getTokens(newUser.id, newUser.email);
    await this.updateRtHash(newUser.id, tokens.refresh_token);
    return tokens;
  }

  async signinLocal(dto: AuthDto): Promise<Tokens> {
    const user = await this.prisma.user.findUnique({
      where: {
        email: dto.email
      }
    })

    if (!user) throw new ForbiddenException('Access Denied');

    const isMatch = await argon.verify(user.hash, dto.password);

    if (!isMatch) throw new ForbiddenException('Access Denied');

    const tokens = await this.getTokens(user.id, user.email);

    await this.updateRtHash(user.id, tokens.refresh_token);

    return tokens;
  }

  async logout(userId: number) {
    await this.prisma.user.updateMany({
      where: {
        id: userId,
        hashRt: {
          not: null,
        }
      },
      data: {
        hashRt: null,
      }
    })
  }

  async refreshToken(userId: number, rt: string): Promise<Tokens> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      }
    })

    if (!user) throw new ForbiddenException('Access Denied');

    const isMatch = await argon.verify(user.hashRt, rt);

    if (!isMatch) throw new ForbiddenException('Access Denied');

    const tokens = await this.getTokens(user.id, user.email);

    await this.updateRtHash(user.id, tokens.refresh_token);

    return tokens;
  }
}