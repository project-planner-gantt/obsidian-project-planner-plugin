export const DEFAULT_TASK_SETTINGS = {
  isNeedToAddCreatedAtDateOnToday: true,
  isNeedToAddScheduledDateOnToday: true,
  isNeedToAddDueDateOnToday: true,
  isNeedToAddCreatedAtDateOnPlanTask: true,
  isNeedToAddScheduledDateOnPlanTask: true,
  isNeedToAddDueDateOnPlanTask: true,
  shiftDatesByWorkingDaysOnly: false,
  weekendDays: [0, 6],
};
export type TaskSettings = typeof DEFAULT_TASK_SETTINGS;
export type TaskBooleanSetting = Exclude<keyof TaskSettings, "weekendDays">;
export function taskSettings(data: Record<string, unknown>): TaskSettings {
  const result = { ...DEFAULT_TASK_SETTINGS, weekendDays: [...DEFAULT_TASK_SETTINGS.weekendDays] };
  for (const key of Object.keys(DEFAULT_TASK_SETTINGS) as (keyof TaskSettings)[]) {
    if (key !== "weekendDays" && typeof data[key] === "boolean") result[key] = data[key];
  }
  if (Array.isArray(data.weekendDays) && data.weekendDays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) {
    result.weekendDays = [...new Set(data.weekendDays)] as number[];
  }
  return result;
}
