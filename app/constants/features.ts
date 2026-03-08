/**
 * @module features
 * Feature flags — set to true to enable, false to suppress UI/API handling.
 *
 * All flagged code is fully implemented and tested.
 * Flip the flag to true when ready to ship; no other changes needed.
 */

export const FEATURES = {
  /**
   * Optional .ip mint during molt.
   * When enabled: shows 'Mint new .ip type (+5 xDAI)' checkbox in MoltStep3.
   * When disabled: checkbox is hidden; existing .ip transfers automatically (no action).
   *
   * Ready to ship — flip to true to enable.
   */
  optionalIPMint: false,

  /**
   * Transak fiat on-ramp ('Pay with Card from $10' button in EvolveModal).
   * When enabled: shows TransakButton below the Evolve CTA.
   * When disabled: button is hidden; users pay with xDAI directly.
   *
   * Requires env vars: NEXT_PUBLIC_TRANSAK_API_KEY, TRANSAK_SECRET_KEY
   * Ready to ship — flip to true and set env vars to enable.
   */
  transakOnRamp: false,

  /**
   * Mercuryo fiat on-ramp fallback ('Pay with Card from $10 (Mercuryo)' button in EvolveModal).
   * Shown when Transak is unavailable in the user's region, or alongside Transak as alternative.
   * When disabled: button is hidden.
   *
   * Requires env vars: NEXT_PUBLIC_MERCURYO_WIDGET_ID, MERCURYO_SECRET_KEY
   * Ready to ship — flip to true and set env vars to enable.
   */
  mercuryoOnRamp: false,
} as const;
