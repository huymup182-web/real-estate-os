'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { accessToken } from '../../../lib/auth/server-session.ts';
import {
  createTeam,
  deleteTeam,
  readTeamForm,
  type TeamFormState,
  teamPayload,
  updateTeam,
  validateTeamForm,
} from '../../../lib/teams.ts';
import { fieldErrorsFrom } from '../../../lib/users.ts';

/** Tạo team (TASK-106). Backend kiểm `team.manage`, phạm vi phòng ban và quy tắc cùng phòng ban. */
export async function createTeamAction(
  _previous: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const values = readTeamForm(formData);
  const fieldErrors = validateTeamForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await createTeam(await accessToken(), teamPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/teams');
  redirect(`/teams/${result.data.id}?saved=created`);
}

export async function updateTeamAction(
  id: string,
  _previous: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const values = readTeamForm(formData);
  const fieldErrors = validateTeamForm(values);
  if (Object.keys(fieldErrors).length > 0) {
    return { error: null, fieldErrors, values };
  }
  const result = await updateTeam(await accessToken(), id, teamPayload(values));
  if (!result.ok) {
    return { error: result.message, fieldErrors: fieldErrorsFrom(result.details), values };
  }
  revalidatePath('/teams');
  redirect(`/teams/${id}?saved=updated`);
}

export async function deleteTeamAction(id: string): Promise<{ error: string | null }> {
  const result = await deleteTeam(await accessToken(), id);
  if (!result.ok) {
    return { error: result.message };
  }
  revalidatePath('/teams');
  redirect('/teams?saved=deleted');
}
