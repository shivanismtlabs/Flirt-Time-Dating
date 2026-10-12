import { z } from 'zod';

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
  body: z.object({
    interestIds: z
      .array(z.string().uuid('Each interestId must be a valid UUID'), {
        required_error: 'interestIds is required',
      })
      .min(1, 'Please select at least 1 interest'),
  }),
});
