import express from 'express';
import { setTimeout as wait } from 'node:timers/promises';
import { prisma } from '../prisma.js';
import { otpSecret } from '../security/settings.js';
import {
  deliveryChannels,
  sendOtp
} from '../services/otpDelivery.js';
import {
  makePasswordRecovery
} from '../services/passwordRecovery.js';

const router = express.Router();

let service;

function recovery() {
  if (!service) {
    service = makePasswordRecovery({
      db: prisma,
      secret: otpSecret(),
      deliver: sendOtp,
      channels: deliveryChannels,
    });
  }

  return service;
}


// ==========================
// AVAILABLE RECOVERY METHODS
// ==========================
router.get(
  '/forgot-password/options',
  (req, res) => {
    const enabled =
      deliveryChannels();

    try {
      otpSecret();
    } catch {
      enabled.email = false;
      enabled.sms = false;
    }

    res
      .set(
        'Cache-Control',
        'no-store'
      )
      .json(enabled);
  }
);


// ==========================
// REQUEST OTP
// ==========================
router.post(
  '/forgot-password',
  async (req, res) => {
    const started =
      Date.now();

    try {
      const result =
        await recovery().request({
          identifier:
            req.body?.identifier,

          channel:
            req.body?.channel,

          ip:
            req.ip,
        });


      // Keep response timing similar
      // whether account exists or not.
      await wait(
        Math.max(
          0,
          500 -
            (Date.now() -
              started)
        )
      );


      res
        .set(
          'Cache-Control',
          'no-store'
        )
        .status(202)
        .json(
          result.body
        );


      // Provider calls happen
      // after generic response.
      void result.dispatch
        ?.()
        .catch(() => {
          console.error(
            'Password recovery dispatch failed.'
          );
        });


      void recovery()
        .cleanup()
        .catch(() => {
          console.error(
            'Password recovery cleanup failed.'
          );
        });

    } catch (error) {

      res
        .status(
          error.status ||
            503
        )
        .json({
          message:
            error.status
              ? error.message
              : 'Password recovery is temporarily unavailable. Contact your administrator.',
        });


      if (!error.status) {
        console.error(
          'Password recovery is unavailable. Check configuration and database migration.'
        );
      }
    }
  }
);


// ==========================
// RESET PASSWORD
// ==========================
router.post(
  '/reset-password',
  async (req, res) => {

    try {
      const result =
        await recovery().reset({
          challengeId:
            req.body
              ?.challengeId,

          code:
            req.body?.code,

          newPassword:
            req.body
              ?.newPassword,

          ip:
            req.ip,
        });


      res
        .set(
          'Cache-Control',
          'no-store'
        )
        .json(result);

    } catch (error) {

      res
        .status(
          error.status ||
            503
        )
        .json({
          message:
            error.status
              ? error.message
              : 'Password reset is temporarily unavailable. Please try again.',
        });


      if (!error.status) {
        console.error(
          'Password reset failed. Check database availability.'
        );
      }
    }
  }
);


export default router;
