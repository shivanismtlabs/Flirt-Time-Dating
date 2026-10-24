export const ONBOARDING_STEP_ORDER = [
  'basicInfo',
  'preferences',
  'genderPreference',
  'religion',
  'interests',
  'photos',
  'audio',
  'faceVerification',
] as const;

export type OnboardingStepName = (typeof ONBOARDING_STEP_ORDER)[number];
export type OnboardingStep = OnboardingStepName | 'completed';

const NEXT_STEP: Record<OnboardingStepName, OnboardingStep> = {
  basicInfo: 'preferences',
  preferences: 'genderPreference',
  genderPreference: 'religion',
  religion: 'interests',
  interests: 'photos',
  photos: 'audio',
  audio: 'faceVerification',
  faceVerification: 'completed',
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

export function resolveCurrentStep(
  stored: string | null | undefined,
  steps: {
    basicInfo: boolean;
    preferences: boolean;
    genderPreference: boolean;
    interests: boolean;
    photos: boolean;
  },
  isCompleted: boolean
): OnboardingStep {
  if (isOnboardingStep(stored)) {
    return stored;
  }
  if (isCompleted) {
    return 'completed';
  }
  if (!steps.basicInfo) return 'basicInfo';
  if (!steps.preferences) return 'preferences';
  if (!steps.genderPreference) return 'genderPreference';
  if (!steps.interests) return 'interests';
  if (!steps.photos) return 'photos';
  return 'completed';
}
