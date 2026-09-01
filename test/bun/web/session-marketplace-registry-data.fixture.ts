export const accessToken = "marketplace-browser-session-token"
export const accountId = "acct-0123456789abcdef"
export const challengeId = "chal-0123456789abcdef"
export const signupChallengeId = "chal-fedcba9876543210"
export const expiresAt = "2030-01-01T00:00:00.000Z"

export const sellerSessions = {
  asOf: "2026-08-20T12:00:00Z",
  ok: true,
  page: { nextCursor: null },
  sessions: [{
    acceptedTokens: null,
    accruedCents: null,
    askCredits: 125,
    datasetId: "seller-dataset-alpha",
    earnedCredits: 100,
    listedAt: "2026-08-19T10:00:00Z",
    model: null,
    modelTokenPricing: [],
    rateCentsPerMillion: null,
    saleStatus: {
      changedAt: "2026-08-20T11:30:00Z",
      exception: null,
      listingCycleId: "22222222-2222-4222-8222-222222222222",
      stage: "sold",
    },
    sessionId: "11111111-1111-4111-8111-111111111111",
    soldAt: "2026-08-20T11:30:00Z",
  }],
}

export const legacySellerSessions = {
  asOf: sellerSessions.asOf,
  ok: true,
  page: sellerSessions.page,
  sessions: sellerSessions.sessions.map((session) => ({
    askCredits: session.askCredits,
    datasetId: session.datasetId,
    earnedCredits: session.earnedCredits,
    listedAt: session.listedAt,
    saleStatus: session.saleStatus,
    sessionId: session.sessionId,
    soldAt: session.soldAt,
  })),
}

export const sellerEarnings = {
  asOf: "2026-08-20T12:00:00Z",
  currency: "USD",
  interval: "day",
  ok: true,
  openingCumulativeCredits: 0,
  points: [
    { cumulativeNetCredits: 0, periodStart: "2026-08-19T00:00:00Z" },
    { cumulativeNetCredits: 100, periodStart: "2026-08-20T00:00:00Z" },
  ],
  window: { from: "2026-07-21", to: "2026-08-20" },
}

export const eligiblePayout = {
  ok: true,
  payoutRequest: {
    availableMinor: 15_000,
    currency: "USD",
    heldMinor: 0,
    request: null,
    thresholdMinor: 10_000,
  },
}
