/** iOS onboarding screens, in order. Resume uses only these values. */
export const ONBOARDING_STEP_ORDER = ['basicInfo', 'photos', 'gesture'] as const;

export const CLIENT_ONBOARDING_STEPS = [...ONBOARDING_STEP_ORDER, 'completed'] as const;

export type OnboardingStepName = (typeof ONBOARDING_STEP_ORDER)[number];
export type OnboardingStep = OnboardingStepName | 'completed';

const NEXT_STEP: Record<OnboardingStepName, OnboardingStep> = {
  basicInfo: 'photos',
  photos: 'gesture',
  gesture: 'completed',
};

export function isOnboardingStep(value: unknown): value is OnboardingStep {
  return (
    value === 'completed' ||
    (typeof value === 'string' &&
      (ONBOARDING_STEP_ORDER as readonly string[]).includes(value))
  );
}

export function stepRank(step?: string | null): number {
  if (!step) return -1;
  if (step === 'completed') return ONBOARDING_STEP_ORDER.length;
  return ONBOARDING_STEP_ORDER.indexOf(step as OnboardingStepName);
}

export function nextOnboardingStep(completedStep: OnboardingStepName): OnboardingStep {
  return NEXT_STEP[completedStep];
}

/**
 * Resume step for the iOS flow: basicInfo → photos → gesture → completed.
 * Stored values outside that set are folded in from profile data so splash
 * never routes to a screen this client does not have.
 */
export function resolveCurrentStep(
  stored: string | null | undefined,
  steps: {
    basicInfo: boolean;
    photos: boolean;
    gesture: boolean;
  }
): OnboardingStep {
  if (stored === 'completed' || steps.gesture) {
    return 'completed';
  }

  if (stored === 'basicInfo' || stored === 'photos' || stored === 'gesture') {
    // Older profile saves parked the user on gesture before any photo existed.
    if (stored === 'gesture' && steps.basicInfo && !steps.photos) {
      return 'photos';
    }
    return stored;
  }

  if (!steps.basicInfo) return 'basicInfo';
  if (!steps.photos) return 'photos';
  return 'gesture';
}
