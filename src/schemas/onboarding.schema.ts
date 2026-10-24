import { z } from 'zod';
import { CLIENT_ONBOARDING_STEPS } from '../utils/onboardingStep';

export const updatePreferencesSchema = z.object({
  body: z.object({
    lookingFor: z.enum(
      ['relationship', 'something_casual', 'figuring_out', 'we_ll_see'],
      {
        required_error: 'lookingFor is required',
        invalid_type_error: 'Invalid lookingFor option. Allowed: relationship, something_casual, figuring_out, we_ll_see',
      }
    ),
  }),
});

export const updateGenderPreferenceSchema = z.object({
  body: z.object({
    genderPreference: z.enum(
      ['men', 'women', 'everyone', 'not_prefer_to_say'],
      {
        required_error: 'genderPreference is required',
        invalid_type_error: 'Invalid genderPreference option. Allowed: men, women, everyone, not_prefer_to_say',
      }
    ),
  }),
});

export const updateReligionSchema = z.object({
  body: z.object({
    religion: z
      .enum(['atheist', 'buddhist', 'catholic', 'christian', 'hindu'], {
        invalid_type_error: 'Invalid religion option. Allowed: atheist, buddhist, catholic, christian, hindu',
      })
      .nullable()
      .optional(),
  }),
});

export const updateInterestsSchema = z.object({
  body: z
    .object({
      interestIds: z
        .array(z.string().uuid('Each interestId must be a valid UUID'))
        .optional(),
      interests: z
        .array(
          z.union([
            z.string().uuid('Each interest must be a valid UUID'),
            z.object({ id: z.string().uuid('Each interest object must have a valid UUID id') }),
          ])
        )
        .optional(),
    })
    .refine(
      (data) =>
        (Array.isArray(data.interestIds) && data.interestIds.length > 0) ||
        (Array.isArray(data.interests) && data.interests.length > 0),
      {
        message: 'Please provide at least 1 interest in interestIds or interests',
        path: ['interestIds'],
      }
    ),
});

export const updateOnboardingStepSchema = z.object({
  body: z.object({
    step: z.enum(CLIENT_ONBOARDING_STEPS, {
      required_error: 'step is required',
      invalid_type_error:
        'Invalid onboarding step. Allowed: basicInfo, photos, gesture, completed',
    }),
  }),
});
