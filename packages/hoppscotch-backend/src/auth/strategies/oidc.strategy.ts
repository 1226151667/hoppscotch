import { Strategy } from 'passport-openidconnect';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import * as O from 'fp-ts/Option';
import { AuthService } from '../auth.service';
import * as E from 'fp-ts/Either';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { validateEmail } from 'src/utils';
import { AUTH_EMAIL_NOT_PROVIDED_BY_OAUTH } from 'src/errors';
import { StatelessStateStore } from '../stateless-state-store';

/**
 * OIDC (OpenID Connect) Strategy.
 *
 * IMPORTANT: NestJS's PassportStrategy wraps validate() with
 * `async (...params) => {}` (rest params), so the actual verify callback
 * arity seen by passport-openidconnect is 0.
 *
 * With passReqToCallback: true and arity 0, the library falls through to:
 *   verify(req, issuer, profile, verified)
 *
 * So the actual parameter mapping is:
 *   validate(req, issuer, profile, verified)
 */
@Injectable()
export class OidcStrategy extends PassportStrategy(Strategy, 'oidc') {
  constructor(
    private usersService: UserService,
    private authService: AuthService,
    private configService: ConfigService,
  ) {
    super({
      issuer: configService.get<string>('INFRA.OIDC_ISSUER'),
      authorizationURL: configService.get<string>('INFRA.OIDC_AUTH_URL'),
      tokenURL: configService.get<string>('INFRA.OIDC_TOKEN_URL'),
      userInfoURL: configService.get<string>('INFRA.OIDC_USER_INFO_URL'),
      clientID: configService.get<string>('INFRA.OIDC_CLIENT_ID'),
      clientSecret: configService.get<string>('INFRA.OIDC_CLIENT_SECRET'),
      callbackURL: configService.get<string>('INFRA.OIDC_CALLBACK_URL'),
      scope: configService
        .get<string>('INFRA.OIDC_SCOPE')
        ?.split(','),
      passReqToCallback: true,
      skipUserProfile: false,  // always fetch from UserInfo endpoint
      store: new StatelessStateStore(
        configService.get<string>('INFRA.SESSION_SECRET'),
        undefined,
        (configService.get<string>('INFRA.SESSION_COOKIE_NAME') ||
          '__oauth_nonce') + '_oidc',
        configService.get<string>('INFRA.ALLOW_SECURE_COOKIES') === 'true',
      ),
    });
  }

  /**
   * Actual signature called by passport-openidconnect (via NestJS wrapper):
   *   validate(req, issuer, profile, verified)
   */
  async validate(
    req: Request,
    issuer: string,
    profile: any,
    verified: (err: Error | null, user?: any) => void,
  ) {
    // passport-openidconnect's Profile.parse doesn't set `provider`,
    // but createUserSSO/createProviderAccount expect it.
    profile.provider = 'oidc';

    const email = profile?.emails?.[0]?.value;

    if (!validateEmail(email))
      throw new UnauthorizedException(AUTH_EMAIL_NOT_PROVIDED_BY_OAUTH);

    const user = await this.usersService.findUserByEmail(email);

    if (O.isNone(user)) {
      const createdUser = await this.usersService.createUserSSO(
        null, // accessToken — not available in the catch-all arity
        null, // refreshToken — not available
        profile,
      );
      return createdUser;
    }

    /**
     * displayName and photoURL maybe null if user logged-in via magic-link before SSO
     */
    if (!user.value.displayName || !user.value.photoURL) {
      const updatedUser = await this.usersService.updateUserDetails(
        user.value,
        profile,
      );
      if (E.isLeft(updatedUser)) {
        throw new UnauthorizedException(updatedUser.left);
      }
    }

    /**
     * Check to see if entry for OIDC is present in the Account table for user
     * If user was created with another provider findUserByEmail may return true
     */
    const providerAccountExists =
      await this.authService.checkIfProviderAccountExists(user.value, profile);

    if (O.isNone(providerAccountExists))
      await this.usersService.createProviderAccount(
        user.value,
        null,
        null,
        profile,
      );

    return user.value;
  }
}
