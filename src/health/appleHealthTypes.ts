export const APPLE_HEALTH_TYPES = {
  heartRateVariability: {
    id: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
    label: 'HRV',
    outputType: 'heart_rate_variability_sdnn'
  },
  restingHeartRate: {
    id: 'HKQuantityTypeIdentifierRestingHeartRate',
    label: 'Rusthartslag',
    outputType: 'resting_heart_rate'
  },
  stepCount: {
    id: 'HKQuantityTypeIdentifierStepCount',
    label: 'Stappen',
    outputType: 'step_count'
  },
  sleepAnalysis: {
    id: 'HKCategoryTypeIdentifierSleepAnalysis',
    label: 'Slaap',
    outputType: 'sleep_analysis'
  }
} as const;

export type SupportedTypeKey = keyof typeof APPLE_HEALTH_TYPES;
export type AppleHealthIdentifier = (typeof APPLE_HEALTH_TYPES)[SupportedTypeKey]['id'];

const typeById = new Map<string, { key: SupportedTypeKey; id: AppleHealthIdentifier; label: string; outputType: string }>(
  Object.entries(APPLE_HEALTH_TYPES).map(([key, value]) => [value.id, { key: key as SupportedTypeKey, ...value }])
);

export function getSupportedType(identifier: string | undefined) {
  return identifier ? typeById.get(identifier) : undefined;
}

export const supportedTypeIds = () => new Set(Object.values(APPLE_HEALTH_TYPES).map((item) => item.id));
