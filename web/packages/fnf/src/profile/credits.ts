import type { ProfileCredits, ProfileCreditsOptions, ProfileWorkspaceWallet } from './types'

export function calculateProfileCredits(
  wallet: ProfileWorkspaceWallet,
  options: ProfileCreditsOptions = {},
): ProfileCredits {
  const includeOnDemand = options.includeOnDemand ?? true

  const rawMonthlyRemaining = Math.max(0, wallet.subscriptionBalance)
  const rawPurchasedCredits = Math.max(0, wallet.creditsBalance)
  const rawOnDemandCredits = includeOnDemand ? Math.max(0, wallet.onDemandCredits) : 0
  const rawPlanCapacity = Math.max(0, wallet.subscriptionTotal)
  const rawAvailableCredits = rawMonthlyRemaining + rawPurchasedCredits
  const rawTotalAvailableCredits = rawAvailableCredits + rawOnDemandCredits
  const rawTotalProgressCapacity = rawPlanCapacity + rawOnDemandCredits
  const rawUsedCredits = Math.max(0, rawPlanCapacity - rawMonthlyRemaining)

  let availablePercent = 0
  if (rawTotalProgressCapacity > 0) {
    availablePercent = (rawTotalAvailableCredits / rawTotalProgressCapacity) * 100
  }
  else if (rawTotalAvailableCredits > 0) {
    availablePercent = 100
  }

  if (Number.isNaN(availablePercent))
    availablePercent = 0
  availablePercent = Math.round(Math.min(100, Math.max(0, availablePercent)))

  const raw = {
    availableCredits: rawAvailableCredits,
    usedCredits: rawUsedCredits,
    monthlyRemaining: rawMonthlyRemaining,
    purchasedCredits: rawPurchasedCredits,
    onDemandCredits: rawOnDemandCredits,
    totalAvailableCredits: rawTotalAvailableCredits,
    totalProgressCapacity: rawTotalProgressCapacity,
    planCapacity: rawPlanCapacity,
  }

  return {
    availablePercent,
    usagePercent: 100 - availablePercent,
    availableCredits: rawAvailableCredits / 100,
    totalAvailableCredits: rawTotalAvailableCredits / 100,
    totalProgressCapacity: rawTotalProgressCapacity / 100,
    usedCredits: rawUsedCredits / 100,
    monthlyRemaining: rawMonthlyRemaining / 100,
    purchasedCredits: rawPurchasedCredits / 100,
    onDemandCredits: rawOnDemandCredits / 100,
    planCapacity: rawPlanCapacity / 100,
    raw,
  }
}
