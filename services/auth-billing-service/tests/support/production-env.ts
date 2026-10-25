/** SEC-08 fixtures: a complete, valid production configuration (every value is fake). */
export const VALID_PRODUCTION_ENV: Record<string, string> = {
  FRONTEND_URL: "https://studio.example",
  LEMONSQUEEZY_API_KEY: "lemon-test-api-key-not-real-0123456789",
  LEMONSQUEEZY_STORE_ID: "123456",
  LEMONSQUEEZY_WEBHOOK_SECRET: "wh-Q7f2Lk9Zp4Rt8Vx1Bn6Cm3Dj5Hs0Ga2E",
  LEMONSQUEEZY_VARIANT_STARTER: "700001",
  LEMONSQUEEZY_VARIANT_PRO: "700002",
  LEMONSQUEEZY_VARIANT_ENTERPRISE: "700003",
  RESEND_API_KEY: "re_test_not_a_real_key_0123456789",
  SENDER_EMAIL: "MoleculeStudio <no-reply@studio.example>",
  BCRYPT_ROUNDS: "12",
};
